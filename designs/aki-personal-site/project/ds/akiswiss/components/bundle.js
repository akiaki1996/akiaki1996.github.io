/* @ds-bundle: {"format":4,"namespace":"AkiSwiss","components":[{"name":"Button"},{"name":"Tag"},{"name":"SpecRow"}]} */
(function () {
  var R = window.React;
  var h = R.createElement;

  function Button(props) {
    var variant = props.variant || "secondary";
    var href = props.href;
    var className = ["aki-btn", "aki-btn-" + variant, props.className].filter(Boolean).join(" ");
    var rest = {};
    for (var k in props) {
      if (Object.prototype.hasOwnProperty.call(props, k) && k !== "variant" && k !== "className" && k !== "children") {
        rest[k] = props[k];
      }
    }
    rest.className = className;
    if (href) {
      return h("a", rest, props.children);
    }
    if (!rest.type) rest.type = "button";
    return h("button", rest, props.children);
  }

  function Tag(props) {
    var tone = props.tone || "neutral";
    var className = ["aki-tag", tone === "accent" ? "aki-tag-accent" : "", props.className].filter(Boolean).join(" ");
    return h("span", { className: className }, props.children);
  }

  function SpecRow(props) {
    return h(
      "div",
      { className: ["aki-spec-row", props.className].filter(Boolean).join(" ") },
      h("span", { className: "aki-spec-label" }, props.label),
      h("span", { className: "aki-spec-value" }, props.value)
    );
  }

  window.AkiSwiss = window.AkiSwiss || {};
  window.AkiSwiss.Button = Button;
  window.AkiSwiss.Tag = Tag;
  window.AkiSwiss.SpecRow = SpecRow;
})();
