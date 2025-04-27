"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestOptions = void 0;
const myHeaders = new Headers();
myHeaders.append("Cookie", "cookiesession1=678A3E2D13AE9A910D8B507F2B62B0C4");
const raw = "";
exports.requestOptions = {
    method: "POST",
    headers: myHeaders,
    body: raw,
    redirect: "follow",
};
