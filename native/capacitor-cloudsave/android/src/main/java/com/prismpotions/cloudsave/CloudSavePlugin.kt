package com.prismpotions.cloudsave

import android.os.Build
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.games.PlayGames
import com.google.android.gms.games.PlayGamesSdk
import com.google.android.gms.games.SnapshotsClient
import com.google.android.gms.games.snapshot.Snapshot
import com.google.android.gms.games.snapshot.SnapshotMetadataChange
import org.json.JSONObject

/**
 * Cloud save over Play Games Services v2 Saved Games.
 *
 * One snapshot, SNAPSHOT_NAME, holds a small JSON envelope:
 *   { "data": "<serialized SaveData>", "updatedAt": <epoch ms>, "device": "<label>" }
 * The game owns conflict resolution between devices; here a Play Games
 * *snapshot* conflict (two devices wrote at once) is settled by the most
 * recently modified copy, which is what the game would upload again anyway.
 *
 * STATUS: written to the Play Games Services v2 / Capacitor 6 APIs, not yet
 * compiled - see native/capacitor-cloudsave/README.md.
 */
@CapacitorPlugin(name = "CloudSave")
class CloudSavePlugin : Plugin() {

    companion object {
        private const val SNAPSHOT_NAME = "chromaflask-save"
        private const val DESCRIPTION = "Prism Potions progress"
    }

    /** False when the SDK refused to start (e.g. a missing or placeholder APP_ID). */
    private var sdkReady = false

    override fun load() {
        // Required once per process before any Play Games client is used. A
        // bad manifest APP_ID must degrade to "cloud save unavailable", never
        // take the whole app down at start-up.
        sdkReady = try {
            PlayGamesSdk.initialize(context)
            true
        } catch (err: Exception) {
            false
        }
    }

    // ---------------------------------------------------------------- state
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val status = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
        call.resolve(JSObject().put("available", sdkReady && status == ConnectionResult.SUCCESS))
    }

    @PluginMethod
    fun currentAccount(call: PluginCall) {
        PlayGames.getGamesSignInClient(activity).isAuthenticated
            .addOnCompleteListener { task ->
                val authed = task.isSuccessful && task.result.isAuthenticated
                if (!authed) {
                    call.resolve(JSObject().put("account", JSONObject.NULL))
                } else {
                    resolveWithPlayerName(call)
                }
            }
    }

    @PluginMethod
    fun signIn(call: PluginCall) {
        PlayGames.getGamesSignInClient(activity).signIn()
            .addOnCompleteListener { task ->
                val authed = task.isSuccessful && task.result.isAuthenticated
                if (!authed) {
                    // Cancelled or refused: not an error from the game's point of view.
                    call.resolve(JSObject().put("account", JSONObject.NULL))
                } else {
                    resolveWithPlayerName(call)
                }
            }
    }

    private fun resolveWithPlayerName(call: PluginCall) {
        PlayGames.getPlayersClient(activity).currentPlayer
            .addOnCompleteListener { task ->
                val name = if (task.isSuccessful) task.result.displayName else "Google Play Games"
                call.resolve(JSObject().put("account", name))
            }
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        // Play Games Services v2 has no explicit sign-out API; the player
        // manages it in the Play Games app. The game treats this as "stop
        // syncing on this device" and forgets the account on its side.
        call.resolve()
    }

    // ------------------------------------------------------------ snapshots
    private fun snapshots(): SnapshotsClient = PlayGames.getSnapshotsClient(activity)

    @PluginMethod
    fun load(call: PluginCall) {
        snapshots()
            .open(SNAPSHOT_NAME, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnFailureListener { err -> call.reject("open failed: ${err.message}") }
            .addOnSuccessListener { result ->
                val snapshot = result.data
                if (snapshot == null) {
                    call.reject("open returned an unresolved conflict")
                    return@addOnSuccessListener
                }
                try {
                    val bytes = snapshot.snapshotContents.readFully()
                    snapshots().discardAndClose(snapshot)
                    if (bytes.isEmpty()) {
                        call.resolve(emptyEnvelope())
                        return@addOnSuccessListener
                    }
                    val env = JSONObject(String(bytes, Charsets.UTF_8))
                    // `optString(name, null)` is a Java-nullability trap in
                    // Kotlin (it types the default as Nothing?); the contract
                    // is `data: string | null`, so branch on it explicitly.
                    val stored: Any =
                        if (env.isNull("data")) JSONObject.NULL else env.optString("data")
                    call.resolve(
                        JSObject()
                            .put("data", stored)
                            .put("updatedAt", env.optLong("updatedAt", 0L))
                            .put("device", env.optString("device", "Android")),
                    )
                } catch (err: Exception) {
                    call.reject("read failed: ${err.message}")
                }
            }
    }

    @PluginMethod
    fun store(call: PluginCall) {
        val data = call.getString("data") ?: run { call.reject("data is required"); return }
        val updatedAt = call.getLong("updatedAt") ?: System.currentTimeMillis()
        val device = call.getString("device") ?: "${Build.MANUFACTURER} ${Build.MODEL}".trim()

        val envelope = JSONObject()
            .put("data", data)
            .put("updatedAt", updatedAt)
            .put("device", device)
            .toString()
            .toByteArray(Charsets.UTF_8)

        snapshots()
            .open(SNAPSHOT_NAME, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED)
            .addOnFailureListener { err -> call.reject("open failed: ${err.message}") }
            .addOnSuccessListener { result ->
                val snapshot: Snapshot = result.data ?: run {
                    call.reject("open returned an unresolved conflict")
                    return@addOnSuccessListener
                }
                snapshot.snapshotContents.writeBytes(envelope)
                val change = SnapshotMetadataChange.Builder()
                    .setDescription(DESCRIPTION)
                    .build()
                snapshots().commitAndClose(snapshot, change)
                    .addOnSuccessListener { call.resolve() }
                    .addOnFailureListener { err -> call.reject("commit failed: ${err.message}") }
            }
    }

    private fun emptyEnvelope(): JSObject =
        JSObject().put("data", JSONObject.NULL).put("updatedAt", 0L).put("device", "Android")

    // ---------------------------------------------------------- leaderboard
    /**
     * Play Games leaderboards, on the same sign-in as saved games above - one
     * account, one consent prompt. The game ranks by campaign stars; the board
     * id comes from JS (src/services/Leaderboard.ts) so every store id lives
     * in one place.
     */
    @PluginMethod
    fun isLeaderboardAvailable(call: PluginCall) {
        val status = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
        call.resolve(JSObject().put("available", sdkReady && status == ConnectionResult.SUCCESS))
    }

    /**
     * Silent by design: a score is posted after a win, and a sign-in sheet
     * thrown at a player who just finished a level would read as a nag. When
     * signed out this resolves having done nothing; the next win retries.
     */
    @PluginMethod
    fun submitLeaderboardScore(call: PluginCall) {
        val id = call.getString("leaderboardId") ?: run { call.reject("leaderboardId is required"); return }
        val score = call.getInt("score") ?: run { call.reject("score is required"); return }
        if (!sdkReady) { call.resolve(); return }
        PlayGames.getGamesSignInClient(activity).isAuthenticated
            .addOnCompleteListener { task ->
                if (task.isSuccessful && task.result.isAuthenticated) {
                    PlayGames.getLeaderboardsClient(activity).submitScore(id, score.toLong())
                }
                call.resolve()
            }
    }

    /**
     * Opens Play Games' own board UI. Unlike posting, this is a deliberate tap,
     * so signing in here is expected rather than intrusive: if the player is
     * signed out we ask once, and a refusal resolves `shown: false` (not an
     * error - the game just says "not signed in" and moves on).
     */
    @PluginMethod
    fun showLeaderboard(call: PluginCall) {
        val id = call.getString("leaderboardId") ?: run { call.reject("leaderboardId is required"); return }
        if (!sdkReady) { call.resolve(notShown()); return }
        val signInClient = PlayGames.getGamesSignInClient(activity)
        signInClient.isAuthenticated.addOnCompleteListener { task ->
            if (task.isSuccessful && task.result.isAuthenticated) {
                openLeaderboard(call, id)
            } else {
                signInClient.signIn().addOnCompleteListener { retry ->
                    if (retry.isSuccessful && retry.result.isAuthenticated) openLeaderboard(call, id)
                    else call.resolve(notShown())
                }
            }
        }
    }

    private fun openLeaderboard(call: PluginCall, id: String) {
        PlayGames.getLeaderboardsClient(activity).getLeaderboardIntent(id)
            .addOnSuccessListener { intent -> startActivityForResult(call, intent, "leaderboardClosed") }
            .addOnFailureListener { err -> call.reject("leaderboard intent failed: ${err.message}") }
    }

    /** The player closed the board. Anything they did there is Google's business. */
    @ActivityCallback
    private fun leaderboardClosed(call: PluginCall?, result: ActivityResult) {
        call?.resolve(JSObject().put("shown", true))
    }

    private fun notShown(): JSObject = JSObject().put("shown", false)
}
