import QRCode from "../../lib/qrcode.js";

function transmitByQR(data){
    let el = document.getElementById("qrcode");
    el.innerHTML = "";
    let qrcode = new QRCode(el, {
        text: data,
        width: 650,
        height: 650,
        colorDark : "#000",
        colorLight : "#ffffff",
        // correctLevel : QRCode.CorrectLevel.H
    });
}

function splitInChunks(str, n) {
    if (n <= 0) throw new Error("Number of chunks must be greater than 0");
    const chunkSize = Math.ceil(str.length / n);
    const chunks = [];
    for (let i = 0; i < str.length; i += chunkSize) {
        chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks;
}
let chunkedData = [];
let chunkIndex = 0;
let chunkInterval = null;
export const numberOfChunks = 30;
export function transmitByQRChunks(data){
    clearInterval(chunkInterval);
    chunkIndex = 0;
    chunkedData = splitInChunks(data, numberOfChunks);
    const tick = ()=>{
        chunkIndex++;
        chunkIndex = chunkIndex % chunkedData.length;
        transmitByQR(JSON.stringify([
            chunkIndex,
            chunkedData[chunkIndex]
        ]));
    };
    chunkInterval = setInterval(tick, 50);
    tick();
}
export function stopTransmitByQRChunks(){
    clearInterval(chunkInterval);
}
