import QRCode from "../../lib/qrcode.js";

export function showRoomQR(roomId) {
    const el = document.getElementById("qrcode");
    if (!el) return;
    el.innerHTML = "";
    new QRCode(el, {
        text: roomId,
        width: 650,
        height: 650,
        colorDark : "#000",
        colorLight : "#ffffff",
    });
}

export function clearQR() {
    const el = document.getElementById("qrcode");
    if (el) {
        el.innerHTML = "";
    }
}
