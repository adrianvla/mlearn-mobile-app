import $ from '../lib/jquery.min.js';
import {displayHomeScreen} from "./screens/home.js";

export const init = () => {
    $(".loading").remove();
    displayHomeScreen();
    $(".close").on("click", displayHomeScreen);
};