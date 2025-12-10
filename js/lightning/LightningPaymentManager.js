// js/lightning/LightningPaymentManager.js
class LightningPaymentManager {
    constructor(nostrManager) {
        this.nostrManager = nostrManager;
        this.lnurlEndpoint = "https://primal.net/.well-known/lnurlp/mustardmoose1";
        this.lightningAddress = "mustardmoose1@primal.net";
    }

    async initiatePayment(amountSats, sessionId) {
        try {
            // 1. Fetch LNURL metadata (this endpoint allows CORS in practice)
            const response = await fetch(this.lnurlEndpoint);
            if (!response.ok) throw new Error(`LNURL fetch failed: ${response.status}`);

            const lnurlData = await response.json();

            // Validate that the LN provider accepts the amount
            if (amountSats < lnurlData.minSendable / 1000 || amountSats > lnurlData.maxSendable / 1000) {
                throw new Error(`Amount ${amountSats} sats is outside allowed range`);
            }

            // 2. DO NOT call lnurlData.callback anymore → avoids CORS completely

            // 3. Return everything the UI needs to show a proper QR code
            const lnurl = lnurlData.tag === "payRequest" ? 
                `lightning:${lnurlData.callback}?amount=${amountSats * 1000}&comment=SatSnakev2+tip` :
                null;

            // Fallback: many wallets understand raw LNURL or Lightning Address
            const bech32Lnurl = this.lnurlToBech32(this.lnurlEndpoint);

            return {
                success: true,
                lnurl: lnurlData,                  // full metadata (contains .lnurl for QR)
                bech32Lnurl: bech32Lnurl,          // lnurl1… string for QR
                lightningAddress: this.lightningAddress,
                amountSats: amountSats,
                sessionId: sessionId
            };

        } catch (err) {
            console.error("LightningPaymentManager error:", err);
            return { success: false, error: err.message };
        }
    }

    // Helper: convert https LNURL endpoint → bech32 lnurl1… string
    lnurlToBech32(url) {
        const encoder = new TextEncoder();
        const data = encoder.encode(url.toLowerCase());
        return this.bech32Encode("lnurl", data);
    }

    // Minimal bech32 encoder (good enough for LNURL)
    bech32Encode(prefix, data) {
        const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
        const words = this.bech32To5Bit(data);
        const checksum = this.bech32CreateChecksum(prefix, words);
        const combined = words.concat(checksum);
        let result = prefix + "1";
        for (let w of combined) result += CHARSET[w];
        return result.toUpperCase();
    }

    bech32To5Bit(data) {
        let bits = 0;
        let bitsLen = 0;
        const words = [];
        for (let b of data) {
            bits = (bits << 8) | b;
            bitsLen += 8;
            while (bitsLen >= 5) {
                bitsLen -= 5;
                words.push((bits >> bitsLen) & 31);
            }
        }
        if (bitsLen > 0) words.push((bits << (5 - bitsLen)) & 31);
        return words;
    }

    bech32CreateChecksum(prefix, data) {
        const gen = [0x3ffffff, 0x3fffffe, 0x3fffffc, 0x3fffff8, 0x3fffff0, 0x3ffffe0];
        let polymod = 1;
        for (let c of prefix + "1") polymod = this.bech32PolymodStep(polymod) ^ (c.charCodeAt(0) & 0x1f);
        for (let d of data) polymod = this.bech32PolymodStep(polymod) ^ d;
        for (let i = 0; i < 6; i++) polymod = this.bech32PolymodStep(polymod);
        polymod ^= 1;
        const chk = [];
        for (let i = 0; i < 6; i++) chk.push((polymod >> 5 * (5 - i)) & 31);
        return chk;
    }

    bech32PolymodStep(pre) {
        const b = pre >> 25;
        return ((pre & 0x1ffffff) << 5) ^
            (-((b >> 0) & 1) & 0x3b6aaaa) ^
            (-((b >> 1) & 1) & 0x1c55556) ^
            (-((b >> 2) & 1) & 0x0e9a2d2) ^
            (-((b >> 3) & 1) & 0x074d32c) ^
            (-((b >> 4) & 1) & 0x03a6945);
    }
}

export default LightningPaymentManager;
