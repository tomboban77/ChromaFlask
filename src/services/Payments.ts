/**
 * In-app purchases behind a swappable driver, mirroring SaveService's pattern.
 *
 * Store policy (both Google Play and the App Store) requires that digital
 * goods are sold through the platform's own billing system - never a web
 * checkout - so this module deliberately has no card/PSP path:
 *
 *  - Google Play (TWA / PWA wrapper): `PlayBillingDriver` below uses the
 *    Digital Goods API + Payment Request API, which route through Play
 *    Billing. Product ids must be created in the Play Console first.
 *  - iOS (Capacitor/native wrapper): add a `StoreKitDriver` that bridges to
 *    a StoreKit plugin (e.g. capacitor community IAP) and satisfies
 *    `PaymentDriver`. Nothing else in the game changes.
 *  - Plain web / development: purchases are unavailable; in dev builds a
 *    simulated driver approves after a short delay so the flow is testable.
 *
 * Displayed prices come from the store catalog at runtime whenever possible
 * (localized currency, tax handling); the catalog strings here are only the
 * offline fallback for screenshots and dev.
 *
 * Purchase lifecycle - the part that protects revenue:
 *
 *   1. `purchase(id)` runs the store sheet and returns the purchase token.
 *      The driver does NOT consume it.
 *   2. The app grants the goods, records the token in the save (so the grant
 *      is idempotent), then calls `consume(token)`.
 *   3. On every boot the app calls `listPending()` and settles anything the
 *      store still holds: paid but never granted (app died between the sheet
 *      and the grant) gets granted now; granted but never consumed just gets
 *      consumed. Either way the player ends up with exactly what they paid
 *      for, exactly once, and the SKU becomes purchasable again.
 */

import type { PowerupId } from '@/core/progression';
import { isNativeApp, platform } from './Platform';

export type ProductId =
  | 'cf.bundle.starter'
  | 'cf.bundle.alchemist'
  | 'cf.coins.small'
  | 'cf.coins.medium'
  | 'cf.coins.large';

export interface IapProduct {
  readonly id: ProductId;
  readonly title: string;
  readonly badge?: string;
  /** Fallback display price; replaced by the store's localized price. */
  readonly fallbackPrice: string;
  readonly coins: number;
  readonly powerups?: Readonly<Partial<Record<PowerupId, number>>>;
  readonly infiniteLivesHours?: number;
}

export const IAP_CATALOG: readonly IapProduct[] = [
  {
    id: 'cf.bundle.starter',
    title: 'Starter Bundle',
    badge: 'Popular',
    fallbackPrice: '$1.99',
    coins: 1000,
    powerups: { undo: 1, hint: 1, bottle: 1 },
    infiniteLivesHours: 1,
  },
  {
    id: 'cf.bundle.alchemist',
    title: 'Alchemist Bundle',
    badge: 'Best value',
    fallbackPrice: '$7.99',
    coins: 2600,
    powerups: { undo: 3, hint: 3, bottle: 3 },
    infiniteLivesHours: 3,
  },
  { id: 'cf.coins.small', title: 'Pouch of coins', fallbackPrice: '$2.99', coins: 1000 },
  { id: 'cf.coins.medium', title: 'Bag of coins', fallbackPrice: '$9.99', coins: 5000 },
  { id: 'cf.coins.large', title: 'Chest of coins', fallbackPrice: '$19.99', coins: 12000 },
];

export function getProduct(id: ProductId): IapProduct {
  const product = IAP_CATALOG.find((p) => p.id === id);
  if (!product) throw new Error(`Unknown product ${id}`);
  return product;
}

export function isProductId(id: string): id is ProductId {
  return IAP_CATALOG.some((p) => p.id === id);
}

/** A purchase the store has recorded but the app has not yet consumed. */
export interface PendingPurchase {
  readonly productId: ProductId;
  readonly token: string;
}

export type PurchaseResult =
  /** `token` is null only for drivers without a token concept (dev simulator). */
  | { ok: true; productId: ProductId; token: string | null }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'failed' };

export interface PaymentDriver {
  readonly name: string;
  /** Resolves once; false means hide real-money purchases entirely. */
  isAvailable(): Promise<boolean>;
  /** Localized display prices keyed by product id, best effort. */
  getPrices(ids: readonly ProductId[]): Promise<Partial<Record<ProductId, string>>>;
  /** Runs the store sheet. Never consumes: the app does that after granting. */
  purchase(id: ProductId): Promise<PurchaseResult>;
  /** Purchases the store still holds as unconsumed. */
  listPending(): Promise<PendingPurchase[]>;
  /** Marks a consumable as delivered so it can be bought again. */
  consume(token: string): Promise<void>;
  /**
   * Purchases the store completes outside `purchase()` - an interrupted
   * checkout, Ask to Buy approved later. Optional; only StoreKit has them.
   */
  onPending?(cb: (p: PendingPurchase) => void): void;
}

// ------------------------------------------------------- Play Billing (TWA)
const PLAY_BILLING_METHOD = 'https://play.google.com/billing';

interface DigitalGoodsItemDetails {
  itemId: string;
  price?: { currency: string; value: string };
}

interface DigitalGoodsPurchaseDetails {
  itemId: string;
  purchaseToken: string;
}

interface DigitalGoodsService {
  getDetails(itemIds: string[]): Promise<DigitalGoodsItemDetails[]>;
  listPurchases(): Promise<DigitalGoodsPurchaseDetails[]>;
  consume(purchaseToken: string): Promise<void>;
}

type GetDigitalGoodsService = (provider: string) => Promise<DigitalGoodsService>;

/**
 * Works when the game ships as a Trusted Web Activity on Android. All calls
 * are defensive: on any failure the shop simply hides real-money items.
 */
export class PlayBillingDriver implements PaymentDriver {
  readonly name = 'play-billing';
  private service: DigitalGoodsService | null = null;

  async isAvailable(): Promise<boolean> {
    try {
      const getter = (window as unknown as Record<string, unknown>)
        .getDigitalGoodsService as GetDigitalGoodsService | undefined;
      if (!getter || !('PaymentRequest' in window)) return false;
      this.service = await getter(PLAY_BILLING_METHOD);
      return this.service !== null;
    } catch {
      return false;
    }
  }

  async getPrices(ids: readonly ProductId[]): Promise<Partial<Record<ProductId, string>>> {
    const out: Partial<Record<ProductId, string>> = {};
    if (!this.service) return out;
    try {
      const details = await this.service.getDetails([...ids]);
      for (const item of details) {
        if (!item.price) continue;
        const formatted = new Intl.NumberFormat(navigator.language, {
          style: 'currency',
          currency: item.price.currency,
        }).format(Number(item.price.value));
        out[item.itemId as ProductId] = formatted;
      }
    } catch {
      /* fall back to catalog prices */
    }
    return out;
  }

  async purchase(id: ProductId): Promise<PurchaseResult> {
    if (!this.service) return { ok: false, reason: 'unavailable' };
    try {
      const request = new PaymentRequest(
        [{ supportedMethods: PLAY_BILLING_METHOD, data: { sku: id } }],
        // Play Billing ignores these totals and shows its own sheet.
        { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } },
      );
      const response = await request.show();
      const token = (response.details as { purchaseToken?: string }).purchaseToken ?? null;
      // The payment has already happened at this point; `complete` only
      // dismisses the sheet. Granting and consuming are the app's job, and
      // `listPending` on the next boot covers anything that dies in between.
      await response.complete('success');
      return { ok: true, productId: id, token };
    } catch (err) {
      const cancelled = err instanceof DOMException && err.name === 'AbortError';
      return { ok: false, reason: cancelled ? 'cancelled' : 'failed' };
    }
  }

  async listPending(): Promise<PendingPurchase[]> {
    if (!this.service) return [];
    try {
      const purchases = await this.service.listPurchases();
      const out: PendingPurchase[] = [];
      for (const p of purchases) {
        if (isProductId(p.itemId) && p.purchaseToken) {
          out.push({ productId: p.itemId, token: p.purchaseToken });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async consume(token: string): Promise<void> {
    if (!this.service) throw new Error('billing unavailable');
    await this.service.consume(token);
  }
}

// ------------------------------------------------------------- dev + web
/** Dev-only stand-in so the whole purchase flow is testable in a browser. */
export class SimulatedDriver implements PaymentDriver {
  readonly name = 'simulated';
  async isAvailable(): Promise<boolean> {
    return true;
  }
  async getPrices(): Promise<Partial<Record<ProductId, string>>> {
    return {};
  }
  async purchase(id: ProductId): Promise<PurchaseResult> {
    await new Promise((r) => setTimeout(r, 650));
    return { ok: true, productId: id, token: `sim-${Date.now()}` };
  }
  async listPending(): Promise<PendingPurchase[]> {
    return [];
  }
  async consume(): Promise<void> {
    /* nothing to consume in the simulator */
  }
}

class UnavailableDriver implements PaymentDriver {
  readonly name = 'unavailable';
  async isAvailable(): Promise<boolean> {
    return false;
  }
  async getPrices(): Promise<Partial<Record<ProductId, string>>> {
    return {};
  }
  async purchase(): Promise<PurchaseResult> {
    return { ok: false, reason: 'unavailable' };
  }
  async listPending(): Promise<PendingPurchase[]> {
    return [];
  }
  async consume(): Promise<void> {
    /* nothing to consume */
  }
}

// ------------------------------------------------ store billing (Capacitor)
/** Loaded on demand: the web bundle never carries the billing wrapper. */
const loadNativePurchases = () => import('@capgo/native-purchases');
type NativePurchasesModule = Awaited<ReturnType<typeof loadNativePurchases>>;

/**
 * Google Play Billing and StoreKit 2 through @capgo/native-purchases, inside
 * the Capacitor wrapper. Consumables only. Loaded on demand so the web bundle
 * never carries it.
 *
 * Android: `purchaseProduct` returns the purchase token; the app grants, then
 * `consume` calls `consumePurchase`, which acknowledges and releases the SKU
 * for repurchase. Anything left unconsumed (app died between the sheet and
 * the grant) is still owned, shows up in `getPurchases`, and is settled by
 * the boot-time restore.
 *
 * iOS: the plugin finishes the StoreKit transaction itself inside
 * `purchaseProduct`, so `consume` is a no-op and the token is the transaction
 * id (still recorded by the app, so a grant is never repeated). Transactions
 * that complete outside the flow - an interrupted checkout, Ask to Buy
 * approved later - arrive through the plugin's `transactionUpdated` event and
 * are forwarded via `onPending`.
 */
export class NativeBillingDriver implements PaymentDriver {
  readonly name = 'native-billing';
  private mod: NativePurchasesModule | null = null;
  private pendingCb: ((p: PendingPurchase) => void) | null = null;
  private readonly ios = platform() === 'ios';

  async isAvailable(): Promise<boolean> {
    if (!isNativeApp()) return false;
    try {
      this.mod = await loadNativePurchases();
      const { isBillingSupported } = await this.mod.NativePurchases.isBillingSupported();
      if (isBillingSupported && this.ios) {
        await this.mod.NativePurchases.addListener('transactionUpdated', (tx) => {
          if (isProductId(tx.productIdentifier) && tx.transactionId) {
            this.pendingCb?.({ productId: tx.productIdentifier, token: tx.transactionId });
          }
        });
      }
      return isBillingSupported;
    } catch {
      return false;
    }
  }

  onPending(cb: (p: PendingPurchase) => void): void {
    this.pendingCb = cb;
  }

  async getPrices(ids: readonly ProductId[]): Promise<Partial<Record<ProductId, string>>> {
    const out: Partial<Record<ProductId, string>> = {};
    if (!this.mod) return out;
    try {
      const { products } = await this.mod.NativePurchases.getProducts({
        productIdentifiers: [...ids],
        productType: this.mod.PURCHASE_TYPE.INAPP,
      });
      for (const p of products) {
        if (isProductId(p.identifier) && p.priceString) out[p.identifier] = p.priceString;
      }
    } catch (err) {
      console.error('[payments] failed to load App Store products', err);
      /* fall back to catalog prices */
    }
    return out;
  }

  async purchase(id: ProductId): Promise<PurchaseResult> {
    if (!this.mod) return { ok: false, reason: 'unavailable' };
    try {
      // Deliberately NOT `isConsumable: true`: that makes the plugin consume
      // inside this call, before the app has granted anything, so a crash in
      // between would lose the goods. Left owned (and acknowledged, so Play
      // never auto-refunds), the purchase is consumed by `consume` after the
      // grant, or by the boot-time restore if this session dies first.
      const tx = await this.mod.NativePurchases.purchaseProduct({
        productIdentifier: id,
        productType: this.mod.PURCHASE_TYPE.INAPP,
        quantity: 1,
      });
      const token = (this.ios ? tx.transactionId : tx.purchaseToken) || tx.transactionId || null;
      return { ok: true, productId: id, token };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[payments] purchase failed for ${id}: ${message}`, err);
      return { ok: false, reason: /cancel/i.test(message) ? 'cancelled' : 'failed' };
    }
  }

  async listPending(): Promise<PendingPurchase[]> {
    // iOS transactions are finished by the plugin; late ones come via onPending.
    if (!this.mod || this.ios) return [];
    try {
      const { purchases } = await this.mod.NativePurchases.getPurchases({
        productType: this.mod.PURCHASE_TYPE.INAPP,
      });
      const out: PendingPurchase[] = [];
      for (const p of purchases) {
        // Play's PurchaseState: 1 = purchased, 2 = pending (not yet paid).
        if (p.purchaseState !== undefined && p.purchaseState !== '1') continue;
        if (isProductId(p.productIdentifier) && p.purchaseToken) {
          out.push({ productId: p.productIdentifier, token: p.purchaseToken });
        }
      }
      return out;
    } catch {
      return [];
    }
  }

  async consume(token: string): Promise<void> {
    if (!this.mod) throw new Error('billing unavailable');
    if (this.ios) return;
    await this.mod.NativePurchases.consumePurchase({ purchaseToken: token });
  }
}

async function pickDriver(): Promise<PaymentDriver> {
  if (isNativeApp()) return new NativeBillingDriver();
  const play = new PlayBillingDriver();
  if (await play.isAvailable()) return play;
  if (import.meta.env.DEV) return new SimulatedDriver();
  return new UnavailableDriver();
}

export class Payments {
  private driver: PaymentDriver = new UnavailableDriver();
  private ready = false;
  private prices: Partial<Record<ProductId, string>> = {};

  /**
   * A purchase the store completed outside `purchase()` (see
   * `PaymentDriver.onPending`). The app settles it like a restored one.
   */
  onPending: ((p: PendingPurchase) => void) | null = null;

  /** Never blocks boot; the shop shows coin items either way. */
  async init(): Promise<void> {
    try {
      this.driver = await pickDriver();
      this.ready = await this.driver.isAvailable();
      if (this.ready) {
        this.driver.onPending?.((p) => this.onPending?.(p));
        this.prices = await this.driver.getPrices(IAP_CATALOG.map((p) => p.id));
      }
    } catch {
      this.ready = false;
    }
  }

  get available(): boolean {
    return this.ready;
  }

  get driverName(): string {
    return this.driver.name;
  }

  displayPrice(id: ProductId): string {
    return this.prices[id] ?? getProduct(id).fallbackPrice;
  }

  purchase(id: ProductId): Promise<PurchaseResult> {
    if (!this.ready) return Promise.resolve({ ok: false, reason: 'unavailable' });
    return this.driver.purchase(id);
  }

  listPending(): Promise<PendingPurchase[]> {
    if (!this.ready) return Promise.resolve([]);
    return this.driver.listPending();
  }

  /** Resolves false (never throws) if the store rejected the consume; retried next boot. */
  async consume(token: string): Promise<boolean> {
    if (!this.ready) return false;
    try {
      await this.driver.consume(token);
      return true;
    } catch {
      return false;
    }
  }
}
