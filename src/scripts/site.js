(function () {
  var root = document.documentElement;
  var themeBtn = document.querySelector("[data-theme-toggle]");

  function currentTheme() {
    return root.getAttribute("data-theme") || "light";
  }

  function applyTheme(next) {
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("aki-theme", next);
    } catch (_) {}
    if (themeBtn) {
      themeBtn.textContent = next === "light" ? "DARK" : "LIGHT";
      themeBtn.setAttribute("aria-pressed", next === "dark" ? "true" : "false");
    }
  }

  applyTheme(currentTheme());

  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      applyTheme(currentTheme() === "light" ? "dark" : "light");
    });
  }

  var printBtn = document.querySelector("[data-print-resume]");
  if (printBtn) {
    printBtn.addEventListener("click", function () {
      window.print();
    });
  }

  var photoBtn = document.querySelector("[data-toggle-photo]");
  var photoWrap = document.querySelector("[data-photo-wrap]");
  if (photoBtn && photoWrap) {
    photoBtn.addEventListener("click", function () {
      var hidden = photoWrap.hasAttribute("hidden");
      if (hidden) {
        photoWrap.removeAttribute("hidden");
        photoBtn.textContent = "收起验光原单";
      } else {
        photoWrap.setAttribute("hidden", "");
        photoBtn.textContent = "展开验光原单";
      }
    });
  }

  var filterBtns = Array.prototype.slice.call(document.querySelectorAll("[data-cat-filter]"));
  var indexBtns = Array.prototype.slice.call(document.querySelectorAll("[data-note-target]"));
  var articles = Array.prototype.slice.call(document.querySelectorAll("[data-note-article]"));

  if (indexBtns.length && articles.length) {
    var activeCat = "全部";

    function selectNote(id, pushHash) {
      indexBtns.forEach(function (btn) {
        var match = btn.getAttribute("data-note-target") === id;
        btn.classList.toggle("is-selected", match);
      });
      articles.forEach(function (art) {
        var match = art.getAttribute("data-note-article") === id;
        if (match) art.removeAttribute("hidden");
        else art.setAttribute("hidden", "");
      });
      if (pushHash && window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "#" + id);
      }
    }

    function filterNotes(cat) {
      activeCat = cat;
      filterBtns.forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-cat-filter") === cat);
      });
      var firstVisible = null;
      var currentSelectedVisible = false;
      indexBtns.forEach(function (btn) {
        var btnCat = btn.getAttribute("data-note-cat");
        var show = cat === "全部" || btnCat === cat;
        if (show) {
          btn.removeAttribute("hidden");
          if (!firstVisible) firstVisible = btn.getAttribute("data-note-target");
          if (btn.classList.contains("is-selected")) currentSelectedVisible = true;
        } else {
          btn.setAttribute("hidden", "");
        }
      });
      if (!currentSelectedVisible && firstVisible) {
        selectNote(firstVisible, true);
      }
    }

    filterBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        filterNotes(btn.getAttribute("data-cat-filter"));
      });
    });

    indexBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        selectNote(btn.getAttribute("data-note-target"), true);
      });
    });

    var hashId = window.location.hash ? window.location.hash.slice(1) : "";
    var hasHashMatch = articles.some(function (a) { return a.getAttribute("data-note-article") === hashId; });
    if (hasHashMatch) {
      selectNote(hashId, false);
    } else {
      filterNotes(activeCat);
    }
  }
})();
