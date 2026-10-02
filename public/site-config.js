// Browser settings shared by every roofcoil.com page and the shop app. Nothing secret
// lives here. The Google Maps key is a browser key: in Google Cloud it is restricted by
// HTTP referrer (roofcoil.com, www.roofcoil.com, shop.roofcoil.com, fortifiedmetals.com,
// www.fortifiedmetals.com, localhost) and by API (Maps JavaScript API, Places API (New)),
// so it is useless anywhere but on these pages. Leave it empty and every address field
// falls back to plain typing with the OpenStreetMap check at submit, as before.
window.RC_CONFIG = Object.assign({ googleMapsKey: "" }, window.RC_CONFIG || {});
