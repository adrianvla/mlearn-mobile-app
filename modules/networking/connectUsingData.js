import {displayScreen} from "../screens/displayScreen.js";
import SimplePeer from "../../lib/simplepeer.min.js";
import {stopDetection} from "./startConnectionByQR.js";
import {NumberOfChunks, setNumberOfChunks, stopTransmitByQRChunks, transmitByQRChunks} from "./showQR.js";
import {setFlashcards, startSync} from "./transmit.js";
import {overwriteWordFreq} from "../SRS/storage.js";
import $ from '../../lib/jquery.min.js';

let p = null;

let collectedChunks = {};

export const collectChunk = (chunk)=>{
    try{chunk = JSON.parse(chunk);}catch(e){
        console.log("Invalid chunk received: " + chunk);
        return;
    }
    collectedChunks[chunk[0]] = chunk[1];
    console.log("Collected chunk " + chunk[0] + " of " + NumberOfChunks());
    $(".camera .progress-bar .easy").css("width", (Object.keys(collectedChunks).length / NumberOfChunks()) * 100 + "%");
    if(Object.keys(collectedChunks).length === NumberOfChunks()){
        console.log("All chunks collected");
        //concat data
        let data = "";
        for(let i = 0; i < NumberOfChunks(); i++){
            data += collectedChunks[i];
        }
        console.log(collectedChunks, JSON.parse(data));
        connectUsingData(JSON.parse(data));
        collectedChunks = {};
    }
};

export const connectUsingData = (data) =>{
    displayScreen("loading-webrtc");
    stopDetection();
    console.log("Connecting using data: ", data);
    try{
        if(p) p.destroy();
        p = null;
    }catch(e){}

    p = new SimplePeer({
        initiator: false,
        trickle: false
    })

    p.on('error', err => console.log('error', err))

    p.on('signal', d => {
        displayScreen("qr");
        console.log('SIGNAL', JSON.stringify(d));
        transmitByQRChunks(JSON.stringify(d));
    })
    p.signal(data);

    let queuedEvents = [];

    let chunks = {};

    function processChunk(c, name){
        //[index, data, total]
        if(!(name in chunks)) chunks[name] = {};
        chunks[name][c[0]] = c[1];
        const total = c[2];
        if(Object.keys(chunks[name]).length < total) return;
        let data = "";
        for(let i = 0; i < total; i++){
            if(!(i in chunks[name])) {
                console.error("Missing chunk", i, chunks[name]);
                return;
            }
            data += chunks[name][i];
        }
        onTransmissionEnd(name, data);
        chunks[name] = {};
    }
    function onTransmissionEnd(name,data){
        switch(name){
            case "sync":
                // console.log(data);
                //truncate data before printing it to console
                console.log(data.substring(0, 1000));
                setFlashcards(JSON.parse(data));
                break;
            case "wordFreq":
                overwriteWordFreq(JSON.parse(data));
                break;
        }
    }

    function processEvent(d){
        d = JSON.parse(d);
        // console.log("Got event", d);
        switch(d.type){
            case "ping":
                break;
            case "sync-chunk":
                processChunk(d.data, "sync");
                break;
            case "wordFreq-chunk":
                processChunk(d.data, "wordFreq");
                break;
        }
    }
    let isConnected = false;
    p.on('connect', () => {
        console.log('Connected!!!')
        // p.send('whatever' + Math.random());
        stopTransmitByQRChunks();
        startSync(p);
        queuedEvents.forEach(processEvent);
        queuedEvents = [];
        isConnected = true;
    })
    p.on('data', d => {
        if(!isConnected) queuedEvents.push(d);
        else processEvent(d);
    });
};