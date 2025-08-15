import $ from '../../lib/jquery.min.js';
import {displaySettingsScreen} from "./settings.js";
import {displayScreen} from "./displayScreen.js";
import {startConnectionByQR} from "../networking/startConnectionByQR.js";
import {getFsLeft, review} from "../SRS/review.js";

let isInit = false;
function init(){
    $(".settings").on("click", displaySettingsScreen);
    $(".camera").on("click",startConnectionByQR);
    $("button.review").on("click",review);
}

export const displayHomeScreen = () => {
    displayScreen("home");
    $(".cards-left").text(getFsLeft());


    if(!isInit) {
        init();
        isInit = true;
    }
}