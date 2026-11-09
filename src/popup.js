(function () {
  "use strict";

  var core = globalThis.ETHGL;
  var radios = document.querySelectorAll('input[name="mode"]');

  function show(mode) {
    radios.forEach(function (radio) {
      radio.checked = radio.value === mode;
    });
  }

  chrome.storage.local.get({ mode: "off" }, function (stored) {
    show(core.normalizeMode(stored.mode));
  });

  radios.forEach(function (radio) {
    radio.addEventListener("change", function () {
      if (radio.checked) chrome.storage.local.set({ mode: radio.value });
    });
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes.mode) show(core.normalizeMode(changes.mode.newValue));
  });
})();
