# ATT resubmission — version 1.0 (2) rejection

## Change

ATT now runs on launch before the UMP network request. The native bridge waits
for an active, visible scene without another presented controller, requests ATT
on the main queue, and checks the resulting authorization status. If permission
remains undetermined, ads stay disabled for that launch. Denied or restricted
permission does not block gameplay. UMP consent still gates ad SDK startup.

The installed AdMob 8.1.0 wrapper wires its consent presenter only during SDK
initialization. The iOS bridge therefore presents the UMP form directly before
initializing ads. Android keeps its existing consent flow.

The purpose string now describes AdMob's use of the advertising identifier;
the old statement that progress never leaves the device was inaccurate because
the app offers cloud save and usage analytics.

## Physical-device verification required before submission

- Use the new build on a physical iPad running the review OS (iPadOS 27).
  Enable Settings → Privacy & Security → Tracking → Allow Apps to Request to Track
  on an eligible, unrestricted test account. Use a fresh install or reset tracking
  permissions and confirm ATT starts as undetermined.
- Record launch, the system ATT prompt, a permission choice, and the following
  profile/tutorial/game flow. The prompt requires no navigation to Settings or ads.
- Verify Allow and Ask App Not to Track separately with reset permissions.
  Also verify previously denied/restricted permission: no repeat prompt and
  gameplay remains available.
- Verify launch offline still requests ATT; failed UMP should leave ads unavailable.
- Verify launching/backgrounding during startup and returning to the app.
- Test a geography requiring UMP with a configured AdMob consent message and a
  registered test device. Confirm the UMP form opens after ATT and privacy options
  remain accessible in Settings when required.
- Inspect network traffic/debugger calls to confirm Mobile Ads initialization and
  ad requests occur only after ATT resolves and UMP permits ads. A recording alone
  cannot prove network behavior. First-party usage analytics is a separate flow;
  confirm PostHog data is not reused/shared for cross-company advertising.

## Submission

1. Increment the Xcode build number, archive, and upload the verified build.
2. Add a reviewer-accessible link to the physical-device recording in App Store
   Connect → App Review Information → Notes; include it in the review reply.
3. Keep App Privacy disclosures consistent with AdMob and analytics practices.
   Do not declare no tracking solely to bypass the rejection.

Suggested reply **after the above checks pass**:

> Hello App Review,
>
> We updated the tracking authorization flow in build [BUILD NUMBER]. On a fresh
> install, the system ATT request appears automatically during launch, before
> Google Mobile Ads initialization or ad requests. It waits for the app's scene
> to become active. The game remains playable if tracking is declined.
>
> We verified this on [PHYSICAL DEVICE] running [OS VERSION]. This recording shows
> fresh-install launch, the ATT prompt, and the subsequent game flow: [VIDEO LINK].
> The recording link is also included in App Review Information → Notes.

References:
- [Apple ATT request requirements](https://developer.apple.com/documentation/apptrackingtransparency/attrackingmanager/requesttrackingauthorization(completionhandler:))
- [Apple user privacy and data use](https://developer.apple.com/app-store/user-privacy-and-data-use/)
- [Google UMP setup](https://developers.google.com/admob/ios/privacy)
