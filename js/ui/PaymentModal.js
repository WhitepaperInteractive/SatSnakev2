// js/ui/PaymentModal.js
import QRCode from "qrcode";

class PaymentModal {
    constructor() {
        this.modal = document.getElementById("paymentModal");
        this.qrContainer = document.getElementById("qrCode");
        this.amountEl = document.getElementById("payAmount");
        this.addressEl = document.getElementById("lightningAddress");
        this.closeBtn = this.modal.querySelector(".close");
        this.closeBtn.onclick = () => this.hide();
    }

    async show(paymentData) {
        if (!paymentData.success) {
            alert("Payment init failed: " + paymentData.error);
            return;
        }

        this.amountEl.textContent = `${paymentData.amountSats} sats`;
        this.addressEl.textContent = paymentData.lightningAddress;

        // Clear previous QR
        this.qrContainer.innerHTML = "";

        // Best option: bech32 LNURL (works in 95%+ of wallets)
        const lnurlString = paymentData.bech32Lnurl;

        // Fallback: some wallets prefer uppercase lightning:LNURL...
        const fallback = `lightning:${lnurlString}`;

        // Generate QR code
        try {
            await QRCode.toCanvas(this.qrContainer, lnurlString, {
                width: 300,
                margin: 2,
                color: { dark: "#000", light: "#fff" }
            });
        } catch (e) {
            console.error("QR generation failed", e);
        }

        // Also show clickable link and copy button
        const linkEl = document.createElement("p");
        linkEl.innerHTML = `<strong>Or open in wallet:</strong> <a href="${fallback}" target="_blank">${paymentData.lightningAddress}</a>`;
        this.qrContainer.after(linkEl);

        // Copy to clipboard button
        const copyBtn = document.createElement("button");
        copyBtn.textContent = "Copy Lightning Address";
        copyBtn.onclick = () => {
            navigator.clipboard.writeText(paymentData.lightningAddress);
            copyBtn.textContent = "Copied!";
            setTimeout(() => copyBtn.textContent = "Copy Lightning Address", 2000);
        };
        linkEl.after(copyBtn);

        this.modal.style.display = "block";
    }

    hide() {
        this.modal.style.display = "none";
    }
}

export default PaymentModal;
