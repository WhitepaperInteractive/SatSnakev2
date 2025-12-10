/**
 * Configuration for SatSnake Bitcoin Lightning Payment System
 */
const SATSNAKE_CONFIG = {
  // Lightning Address to receive zaps
  recipientLightningAddress: "mustardmoose1@primal.net",
  
  // Nostr pubkey of the lightning address owner (you'll get this from Primal)
  // This can be derived from the Lightning Address via LUD-16 lookup
  recipientNostrPubkey: "", // Will be populated dynamically
  
  // Minimum amount to unlock game (in satoshis)
  minPaymentSats: 100,
  
  // Nostr relays to listen for zap receipts
  relays: [
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://nostr-pub.wellorder.net",
    "wss://relay.nostr.band",
  ],
  
  // How long to wait for a zap receipt after payment (milliseconds)
  zapReceiptTimeout: 60000, // 60 seconds
  
  // Relay connection timeout
  relayTimeout: 5000,
  
  // Game duration after payment (milliseconds)
  // Set to 0 for unlimited
  gameDuration: 0,
  
  // Display settings
  ui: {
    showQrCode: true,
    showPaymentAmount: true,
    showRelayStatus: true,
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SATSNAKE_CONFIG;
}
