/**
 * Lightning Payment UI Manager
 * Handles LNURL payment requests and UI for SatSnake
 */

class LightningPaymentManager {
  constructor(config) {
    this.config = config;
    this.currentSession = null;
    this.paymentInProgress = false;
  }

  /**
   * Initiate payment flow
   * Creates a zap request and gets invoice from LNURL endpoint
   */
  async initiatePayment(amountSats = null) {
    try {
      if (this.paymentInProgress) {
        console.warn("[Lightning] Payment already in progress");
        return null;
      }

      const amount = amountSats || this.config.minPaymentSats;
      console.log(`[Lightning] Initiating payment: ${amount} sats`);

      this.paymentInProgress = true;

      // Create unique session ID for this payment
      const sessionId = this.generateSessionId();
      const amountMsats = amount * 1000;

      // Fetch LNURL endpoint metadata
      const lnurlData = await this.fetchLnurlMetadata();
      if (!lnurlData) {
        throw new Error("Failed to fetch LNURL metadata");
      }

      // Check if LNURL supports NIP-57 (nostr zaps)
      if (!lnurlData.allowsNostr) {
        throw new Error(
          "Lightning Address does not support Nostr zaps (NIP-57)"
        );
      }

      // Create zap request event (kind 9734)
      const zapRequest = this.createZapRequest(
        sessionId,
        amount,
        lnurlData.nostrPubkey
      );

      console.log("[Lightning] Zap request created:", zapRequest);

      // Get invoice from LNURL callback
      const invoice = await this.getInvoiceFromCallback(
        lnurlData.callback,
        amountMsats,
        zapRequest,
        lnurlData.lnurl
      );

      if (!invoice) {
        throw new Error("Failed to get invoice from LNURL");
      }

      // Store session info
      this.currentSession = {
        id: sessionId,
        amountSats: amount,
        amountMsats,
        invoice,
        zapRequest,
        createdAt: Date.now(),
      };

      console.log("[Lightning] Invoice received, ready for payment");
      return {
        invoice,
        amountSats: amount,
        sessionId,
      };
    } catch (error) {
      console.error("[Lightning] Payment initiation error:", error);
      this.paymentInProgress = false;
      return null;
    }
  }

  /**
   * Fetch LNURL metadata from Lightning Address domain
   */
  async fetchLnurlMetadata() {
    try {
      const [username, domain] = this.config.recipientLightningAddress.split(
        '@'
      );

      const url = `https://${domain}/.well-known/lnurlp/${username}`;
      console.log(`[Lightning] Fetching LNURL metadata: ${url}`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'LNURL error');
      }

      // Validate required fields
      if (!data.callback) {
        throw new Error("No callback URL in LNURL response");
      }

      // Encode LNURL for zap requests (bech32)
      const lnurl = this.encodeLnurl(url);

      return {
        ...data,
        lnurl,
        domain,
        username,
      };
    } catch (error) {
      console.error("[Lightning] Error fetching LNURL metadata:", error);
      return null;
    }
  }

  /**
   * Create a zap request event (NIP-57 kind 9734)
   */
  createZapRequest(sessionId, amountSats, recipientPubkey) {
    const now = Math.floor(Date.now() / 1000);
    const amountMsats = amountSats * 1000;

    const event = {
      kind: 9734, // Zap request
      content: `SatSnake game session: ${sessionId}`,
      pubkey: "", // In browser, we don't know our own pubkey unless authenticated
      created_at: now,
      tags: [
        ["relays", ...this.config.relays],
        ["amount", amountMsats.toString()],
        ["lnurl", this.config.recipientLightningAddress],
        ["p", recipientPubkey],
      ],
    };

    // Note: In a full implementation, you'd sign this with NIP-07 extension
    // For now, we'll let the LNURL server handle it
    // const signed = await signEvent(event, privateKey);
    // return signed;

    return event;
  }

  /**
   * Get invoice from LNURL callback using zap request
   */
  async getInvoiceFromCallback(callback, amountMsats, zapRequest, lnurl) {
    try {
      // Encode the zap request as required by NIP-57
      const zapRequestJson = JSON.stringify(zapRequest);
      const encodedZapRequest = encodeURIComponent(zapRequestJson);

      const callbackUrl = new URL(callback);
      callbackUrl.searchParams.append('amount', amountMsats.toString());
      callbackUrl.searchParams.append('nostr', encodedZapRequest);
      if (lnurl) {
        callbackUrl.searchParams.append('lnurl', lnurl);
      }

      console.log(`[Lightning] Requesting invoice from callback...`);

      const response = await fetch(callbackUrl.toString());
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'ERROR') {
        throw new Error(data.reason || 'Callback error');
      }

      if (!data.pr) {
        throw new Error("No invoice (pr) in callback response");
      }

      console.log("[Lightning] Invoice received");
      return data.pr; // BOLT11 invoice
    } catch (error) {
      console.error("[Lightning] Error getting invoice:", error);
      return null;
    }
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId() {
    return `satsnake-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Encode LNURL (bech32 encoding)
   * For a full implementation, use a bech32 library
   */
  encodeLnurl(url) {
    // This is a simplified version
    // In production, use: https://www.npmjs.com/package/bech32
    // or another bech32 encoder
    return 'lnurl1' + btoa(url).replace(/=/g, '').toLowerCase();
  }

  /**
   * Display payment QR code to user
   */
  displayQrCode(invoice, amountSats, container) {
    try {
      // Clear container
      container.innerHTML = '';

      // Create a simple Lightning URI
      const lightningUri = `lightning:${invoice}`;

      // Use a QR code library (e.g., QRCode.js)
      // Install with: npm install qrcode
      // or use CDN: <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcode.js/1.5.0/qrcode.min.js"></script>

      if (typeof QRCode !== 'undefined') {
        const qr = new QRCode(container, {
          text: lightningUri,
          width: 200,
          height: 200,
          correctLevel: QRCode.CorrectLevel.H,
        });
        console.log("[Lightning] QR code displayed");
      } else {
        // Fallback: Display as text
        const fallback = document.createElement('div');
        fallback.className = 'payment-fallback';
        fallback.innerHTML = `
          <p>Scan with Lightning Wallet:</p>
          <code>${invoice}</code>
          <p>Amount: ${amountSats} sats</p>
        `;
        container.appendChild(fallback);
      }
    } catch (error) {
      console.error("[Lightning] Error displaying QR code:", error);
    }
  }

  /**
   * Copy invoice to clipboard
   */
  copyInvoiceToClipboard(invoice) {
    try {
      navigator.clipboard.writeText(invoice);
      console.log("[Lightning] Invoice copied to clipboard");
      return true;
    } catch (error) {
      console.error("[Lightning] Error copying invoice:", error);
      return false;
    }
  }

  /**
   * Mark payment as completed
   */
  completePayment() {
    this.paymentInProgress = false;
    const sessionId = this.currentSession?.id;
    this.currentSession = null;
    return sessionId;
  }

  /**
   * Reset payment state
   */
  resetPayment() {
    this.paymentInProgress = false;
    this.currentSession = null;
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = LightningPaymentManager;
}
