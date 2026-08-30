/* Alliance code policy.
 * The long-form Chinese dictionary can be added on the backend later.
 * This client-side layer only handles the current 1-3 uppercase A-Z code rule.
 */
(function (root) {
  "use strict";
  var RESERVED = new Set([
    "ASS", "SEX", "FCK", "FUC", "KKK", "NIG", "CUM", "ISIS", "XXX"
  ]);
  function normalize(value) { return String(value == null ? "" : value).trim().toUpperCase(); }
  function validate(value) {
    var code = normalize(value);
    if (!/^[A-Z]{1,3}$/.test(code)) return { ok:false, reason:"联盟代号只能是 1～3 位大写英文字母" };
    if (RESERVED.has(code)) return { ok:false, reason:"该联盟代号不可用，请更换一个" };
    return { ok:true, code:code };
  }
  root.AlliancePolicy = { normalize:normalize, validate:validate, reservedCodes:Array.from(RESERVED) };
})(typeof window !== "undefined" ? window : globalThis);
