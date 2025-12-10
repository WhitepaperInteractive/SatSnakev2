/**
 * Modified SatSnake Game with Bitcoin Lightning Payment
 */

class SatSnakeGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.gameUnlocked = false;
    
    // Initialize payment managers
    this.relayManager = null;
    this.paymentManager = null;
    
    // Setup payment UI
    this.setupPaymentUI();
  }

  /**
   * Setup payment UI elements
   */
  setupPaymentUI() {
    // Create payment overlay
    const overlay = document.createElement('div');
    overlay.id = 'payment-overlay';
    overlay.innerHTML = `
      <div class="payment-modal">
        <h2>Unlock SatSnake</h2>
        <p>Pay with Bitcoin Lightning to play</p>
        
        <div id="relay-status" class="relay-status"></div>
        
        <div class="payment-section">
          <div id="qr-container" class="qr-container"></div>
          
          <div class="payment-info">
            <p id="amount-display"></p>
            <button id="copy-invoice-btn" class="btn">Copy Invoice</button>
          </div>
        </div>
        
        <div class="waiting-section" id="waiting-section" style="display:none;">
          <p>Waiting for payment confirmation...</p>
          <div class="spinner"></div>
          <p id="payment-status"></p>
        </div>
        
        <button id="unlock-btn" class="btn btn-primary">Generate Invoice</button>
        <button id="demo-btn" class="btn btn-secondary">Play Demo</button>
      </div>
    `;
    document.body.appendChild(overlay);
    
    this.paymentOverlay = overlay;
    
    // Attach event listeners
    document.getElementById('unlock-btn').addEventListener('click', 
      () => this.initiatePayment()
    );
    document.getElementById('copy-invoice-btn').addEventListener('click',
      () => this.copyInvoice()
    );
    document.getElementById('demo-btn').addEventListener('click',
      () => this.playDemo()
    );
  }

  /**
   * Initialize payment system
   */
  async initializePaymentSystem() {
    try {
      console.log("[Game] Initializing payment system...");
      
      // Initialize Nostr relay manager
      this.relayManager = new NostrRelayManager(SATSNAKE_CONFIG);
      const relayInitialized = await this.relayManager.initialize();
      
      if (!relayInitialized) {
        console.error("[Game] Failed to initialize Nostr relay manager");
        this.updateRelayStatus('⚠️ Relay connection failed');
        // Continue anyway - payment might still work
      } else {
        this.updateRelayStatus('✓ Connected to Nostr relays');
      }
      
      // Initialize Lightning payment manager
      this.paymentManager = new LightningPaymentManager(SATSNAKE_CONFIG);
      
      console.log("[Game] Payment system initialized");
      return true;
    } catch (error) {
      console.error("[Game] Error initializing payment system:", error);
      this.updateRelayStatus('⚠️ Payment system error');
      return false;
    }
  }

  /**
   * Initiate payment process
   */
  async initiatePayment() {
    try {
      console.log("[Game] Initiating payment...");
      
      const paymentResult = await this.paymentManager.initiatePayment();
      if (!paymentResult) {
        alert('Failed to create payment. Please try again.');
        return;
      }

      // Display invoice
      document.getElementById('unlock-btn').style.display = 'none';
      document.getElementById('demo-btn').style.display = 'none';
      document.getElementById('waiting-section').style.display = 'block';

      // Show QR code
      if (SATSNAKE_CONFIG.ui.showQrCode) {
        this.paymentManager.displayQrCode(
          paymentResult.invoice,
          paymentResult.amountSats,
          document.getElementById('qr-container')
        );
      }

      // Display amount
      document.getElementById('amount-display').textContent = 
        `Amount: ${paymentResult.amountSats} sats`;

      // Update button
      const copyBtn = document.getElementById('copy-invoice-btn');
      copyBtn.style.display = 'block';
      copyBtn.dataset.invoice = paymentResult.invoice;

      // Start listening for zap receipt
      this.listenForPayment(
        paymentResult.sessionId,
        paymentResult.amountSats
      );
    } catch (error) {
      console.error("[Game] Payment initiation error:", error);
      alert('Error initiating payment: ' + error.message);
    }
  }

  /**
   * Listen for zap receipt from Nostr relays
   */
  async listenForPayment(sessionId, expectedAmountSats) {
    try {
      const timeout = setTimeout(() => {
        console.error("[Game] Payment timeout");
        this.updatePaymentStatus('Payment timeout. Please try again.');
        this.resetPaymentUI();
      }, SATSNAKE_CONFIG.zapReceiptTimeout);

      // Set up listener
      const unsubscribe = await this.relayManager.listenForZapReceipt(
        sessionId,
        expectedAmountSats,
        (zapReceipt) => {
          clearTimeout(timeout);
          
          if (zapReceipt.valid) {
            console.log("[Game] ✓ Payment confirmed!");
            this.updatePaymentStatus(
              `✓ Payment confirmed! (${zapReceipt.amountSats} sats)`
            );
            
            // Unlock game
            this.unlockGame();
            
            // Hide payment UI after a delay
            setTimeout(() => {
              this.paymentOverlay.style.display = 'none';
            }, 2000);
          } else {
            this.updatePaymentStatus('Invalid payment received.');
          }
        }
      );

      // Store unsubscribe function for cleanup
      this.zapReceiptUnsubscribe = unsubscribe;
    } catch (error) {
      console.error("[Game] Error setting up payment listener:", error);
      this.updatePaymentStatus('Error listening for payment: ' + error.message);
    }
  }

  /**
   * Unlock game after successful payment
   */
  unlockGame() {
    this.gameUnlocked = true;
    this.paymentManager.completePayment();
    
    // Start game loop
    this.startGameLoop();
    
    console.log("[Game] ✓ Game unlocked!");
  }

  /**
   * Play demo/free version of game
   */
  playDemo() {
    console.log("[Game] Playing demo mode");
    this.gameUnlocked = true;
    this.paymentOverlay.style.display = 'none';
    this.startGameLoop();
  }

  /**
   * Start the main game loop
   */
  startGameLoop() {
    if (this.gameLoopRunning) return;
    this.gameLoopRunning = true;
    
    // Initialize game state
    this.initializeGame();
    
    // Game loop
    const loop = () => {
      this.update();
      this.render();
      requestAnimationFrame(loop);
    };
    
    requestAnimationFrame(loop);
  }

  /**
   * Initialize game state
   */
  initializeGame() {
    // Your existing game initialization code
    console.log("[Game] Initializing game state...");
    // ... setup snake, food, etc.
  }

  /**
   * Update game state
   */
  update() {
    // Your existing game update code
  }

  /**
   * Render game
   */
  render() {
    // Your existing game render code
  }

  /**
   * Copy invoice to clipboard
   */
  copyInvoice() {
    const btn = document.getElementById('copy-invoice-btn');
    const invoice = btn.dataset.invoice;
    this.paymentManager.copyInvoiceToClipboard(invoice);
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = 'Copy Invoice';
    }, 2000);
  }

  /**
   * Update payment status message
   */
  updatePaymentStatus(message) {
    document.getElementById('payment-status').textContent = message;
  }

  /**
   * Update relay connection status
   */
  updateRelayStatus(message) {
    const statusEl = document.getElementById('relay-status');
    if (statusEl) {
      statusEl.textContent = message;
    }
  }

  /**
   * Reset payment UI
   */
  resetPaymentUI() {
    document.getElementById('unlock-btn').style.display = 'block';
    document.getElementById('demo-btn').style.display = 'block';
    document.getElementById('waiting-section').style.display = 'none';
    document.getElementById('qr-container').innerHTML = '';
  }

  /**
   * Cleanup on page unload
   */
  async cleanup() {
    if (this.zapReceiptUnsubscribe) {
      this.zapReceiptUnsubscribe();
    }
    if (this.relayManager) {
      await this.relayManager.disconnect();
    }
  }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', async () => {
  const canvas = document.getElementById('gameCanvas');
  const game = new SatSnakeGame(canvas);
  
  // Initialize payment system
  await game.initializePaymentSystem();
  
  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    game.cleanup();
  });
});
