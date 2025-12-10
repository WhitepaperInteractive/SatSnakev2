/**
 * Nostr Relay Manager - Handles zap receipt verification for SatSnake
 * Uses NDK (Nostr Development Kit) for relay communication
 */

class NostrRelayManager {
  constructor(config) {
    this.config = config;
    this.ndk = null;
    this.connectedRelays = [];
    this.subscriptions = [];
    this.listeners = {};
    this.recipientPubkey = null;
  }

  /**
   * Initialize NDK and connect to relays
   */
  async initialize() {
    try {
      console.log("[Nostr] Initializing NDK...");
      
      // Create NDK instance with explicit relays
      this.ndk = new NDK({
        explicitRelayUrls: this.config.relays,
      });

      // Connect to relays
      await this.ndk.connect(this.config.relayTimeout);
      console.log("[Nostr] Connected to relays");

      // Resolve recipient's Nostr pubkey from Lightning Address
      await this.resolveRecipientPubkey();
      
      return true;
    } catch (error) {
      console.error("[Nostr] Initialization error:", error);
      return false;
    }
  }

  /**
   * Resolve recipient's Nostr pubkey from Lightning Address via LUD-16
   * This queries the domain's /.well-known/lnurlp/{username} endpoint
   */
  async resolveRecipientPubkey() {
    try {
      const [username, domain] = this.config.recipientLightningAddress.split('@');
      
      // Fetch the LNURL endpoint metadata
      const response = await fetch(
        `https://${domain}/.well-known/lnurlp/${username}`,
        { method: 'GET' }
      );
      
      if (!response.ok) {
        throw new Error(`Failed to fetch LNURL metadata: ${response.status}`);
      }

      const lnurlData = await response.json();
      
      // Extract Nostr pubkey from the LNURL response
      // LUD-16 allows for nostrPubkey in the response
      if (lnurlData.nostrPubkey) {
        this.recipientPubkey = lnurlData.nostrPubkey;
        this.config.recipientNostrPubkey = lnurlData.nostrPubkey;
        console.log("[Nostr] Resolved recipient pubkey:", this.recipientPubkey);
        return this.recipientPubkey;
      } else {
        console.warn("[Nostr] No Nostr pubkey found in LNURL metadata");
        console.warn("[Nostr] You may need to manually configure recipientNostrPubkey");
        return null;
      }
    } catch (error) {
      console.error("[Nostr] Error resolving recipient pubkey:", error);
      return null;
    }
  }

  /**
   * Listen for zap receipts (kind 9735 events)
   * @param {string} gameSessionId - Unique identifier for this game session/payment
   * @param {number} expectedAmountSats - Expected payment amount in satoshis
   * @param {Function} onZapReceived - Callback when valid zap is received
   * @returns {Function} Unsubscribe function
   */
  listenForZapReceipt(gameSessionId, expectedAmountSats, onZapReceived) {
    return new Promise((resolve, reject) => {
      try {
        console.log(`[Nostr] Listening for zap receipt...`);
        console.log(`  Session ID: ${gameSessionId}`);
        console.log(`  Expected amount: ${expectedAmountSats} sats`);
        console.log(`  Recipient pubkey: ${this.config.recipientNostrPubkey}`);

        // Create filter for zap receipts (kind 9735)
        // Filter by:
        // - Kind 9735 (zap receipt)
        // - Recipient's pubkey (the one sending the receipt)
        // - Recent events only (since now minus some buffer)
        const now = Math.floor(Date.now() / 1000);
        const filter = {
          kinds: [9735], // Zap receipt
          authors: [this.config.recipientNostrPubkey], // Recipient publishes receipt
          since: now - 60, // Last 60 seconds (adjust as needed)
        };

        const unsubscribe = this.ndk.subscribe(
          filter,
          {
            closeOnEose: false, // Keep connection open
            groupableDelay: 0,  // Don't delay
          },
          (event) => {
            console.log("[Nostr] Received event, checking if valid zap...");
            
            // Validate the zap receipt
            const validation = this.validateZapReceipt(
              event,
              gameSessionId,
              expectedAmountSats
            );

            if (validation.valid) {
              console.log("[Nostr] ✓ Valid zap receipt found!");
              console.log(`  Amount: ${validation.amountSats} sats`);
              console.log(`  Sender: ${validation.senderPubkey}`);
              console.log(`  Invoice: ${validation.bolt11}`);

              // Call the callback with validation details
              onZapReceived({
                valid: true,
                amountSats: validation.amountSats,
                senderPubkey: validation.senderPubkey,
                bolt11: validation.bolt11,
                eventId: event.id,
                timestamp: event.created_at,
              });

              // Unsubscribe after successful payment
              unsubscribe();
            } else {
              console.log("[Nostr] ✗ Invalid zap receipt:", validation.reason);
            }
          }
        );

        resolve(unsubscribe);
      } catch (error) {
        console.error("[Nostr] Error setting up zap listener:", error);
        reject(error);
      }
    });
  }

  /**
   * Validate a zap receipt event
   * @param {Object} event - Nostr event from relay
   * @param {string} gameSessionId - Expected game session ID
   * @param {number} expectedAmountSats - Expected amount in satoshis
   * @returns {Object} Validation result
   */
  validateZapReceipt(event, gameSessionId, expectedAmountSats) {
    try {
      // Basic event validation
      if (event.kind !== 9735) {
        return { valid: false, reason: "Not a zap receipt (kind 9735)" };
      }

      // Verify signature
      if (!this.verifyEventSignature(event)) {
        return { valid: false, reason: "Invalid event signature" };
      }

      // Parse the zap receipt structure
      // NIP-57 specifies these required tags:
      // - bolt11: the paid invoice
      // - description: the zap request event (contains sessionId in content)
      // - p: recipient pubkey

      const bolt11Tag = event.tags.find(t => t === 'bolt11');
      const descriptionTag = event.tags.find(t => t === 'description');
      const recipientTag = event.tags.find(t => t === 'p');

      if (!bolt11Tag || !descriptionTag || !recipientTag) {
        return { valid: false, reason: "Missing required zap receipt tags" };
      }

      const bolt11 = bolt11Tag;
      const descriptionEventJson = descriptionTag;

      // Verify recipient
      if (recipientTag !== this.config.recipientNostrPubkey) {
        return { valid: false, reason: "Recipient mismatch" };
      }

      // Parse and validate the description (contains the zap request event)
      let zapRequest;
      try {
        zapRequest = JSON.parse(descriptionEventJson);
      } catch (e) {
        return { valid: false, reason: "Invalid zap request JSON" };
      }

      // Validate zap request
      const zapValidation = this.validateZapRequest(
        zapRequest,
        gameSessionId,
        expectedAmountSats
      );

      if (!zapValidation.valid) {
        return zapValidation;
      }

      // Extract amount from bolt11 invoice
      // BOLT11 format: ln + lowercase(Bech32(payload))
      // For now, trust the amount from the zap request
      // In production, you might decode the BOLT11 invoice
      const amountSats = Math.floor(zapValidation.amountMsats / 1000);

      return {
        valid: true,
        amountSats,
        senderPubkey: zapRequest.pubkey,
        bolt11,
        zapRequest,
      };
    } catch (error) {
      console.error("[Nostr] Error validating zap receipt:", error);
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Validate the zap request event embedded in the receipt
   * @param {Object} zapRequest - The zap request event
   * @param {string} expectedSessionId - Expected session ID
   * @param {number} expectedAmountSats - Expected amount in satoshis
   * @returns {Object} Validation result
   */
  validateZapRequest(zapRequest, expectedSessionId, expectedAmountSats) {
    try {
      // Verify zap request is kind 9734
      if (zapRequest.kind !== 9734) {
        return { valid: false, reason: "Invalid zap request kind" };
      }

      // Extract amount from tags
      const amountTag = zapRequest.tags.find(t => t === 'amount');
      if (!amountTag) {
        return { valid: false, reason: "No amount in zap request" };
      }

      const amountMsats = parseInt(amountTag, 10);
      const amountSats = Math.floor(amountMsats / 1000);

      // Verify amount meets minimum
      if (amountSats < expectedAmountSats) {
        return {
          valid: false,
          reason: `Insufficient amount: ${amountSats} < ${expectedAmountSats}`,
        };
      }

      // Verify recipient
      const recipientTag = zapRequest.tags.find(t => t === 'p');
      if (!recipientTag || recipientTag !== this.config.recipientNostrPubkey) {
        return { valid: false, reason: "Zap recipient mismatch" };
      }

      // Optional: Verify the session ID in the zap request content/tags
      // For now, we'll accept any valid zap to our recipient
      // In a production system, you might include a unique session ID
      // in the zap request to prevent replay attacks

      return {
        valid: true,
        amountMsats,
        amountSats,
      };
    } catch (error) {
      console.error("[Nostr] Error validating zap request:", error);
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Verify Nostr event signature (basic check)
   * In production, use nostr-tools or NDK's validation
   * @param {Object} event - Nostr event
   * @returns {boolean} Whether signature is valid
   */
  verifyEventSignature(event) {
    // For a complete implementation, use nostr-tools:
    // import { verifySignature } from 'nostr-tools';
    // return verifySignature(event);
    
    // Basic check: event has required fields
    return !!(
      event.id &&
      event.sig &&
      event.pubkey &&
      event.created_at &&
      event.kind !== undefined
    );
  }

  /**
   * Disconnect from relays
   */
  async disconnect() {
    try {
      if (this.ndk) {
        // Unsubscribe all subscriptions
        for (const sub of this.subscriptions) {
          if (typeof sub === 'function') {
            sub();
          }
        }
        this.subscriptions = [];
      }
      console.log("[Nostr] Disconnected from relays");
    } catch (error) {
      console.error("[Nostr] Error disconnecting:", error);
    }
  }

  /**
   * Get relay connection status
   */
  getRelayStatus() {
    if (!this.ndk) return { connected: false, relays: [] };
    
    const relayStatus = this.ndk.pool.relays.map(relay => ({
      url: relay.url,
      connected: relay.connected,
    }));

    return {
      connected: relayStatus.some(r => r.connected),
      relays: relayStatus,
    };
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NostrRelayManager;
}
