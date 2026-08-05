const units = ["", "jeden", "dwa", "trzy", "cztery", "pięć", "sześć", "siedem", "osiem", "dziewięć"];
const teens = [
  "dziesięć",
  "jedenaście",
  "dwanaście",
  "trzynaście",
  "czternaście",
  "piętnaście",
  "szesnaście",
  "siedemnaście",
  "osiemnaście",
  "dziewiętnaście"
];
const tens = [
  "",
  "dziesięć",
  "dwadzieścia",
  "trzydzieści",
  "czterdzieści",
  "pięćdziesiąt",
  "sześćdziesiąt",
  "siedemdziesiąt",
  "osiemdziesiąt",
  "dziewięćdziesiąt"
];
const hundreds = [
  "",
  "sto",
  "dwieście",
  "trzysta",
  "czterysta",
  "pięćset",
  "sześćset",
  "siedemset",
  "osiemset",
  "dziewięćset"
];
const groups = [
  ["", "", ""],
  ["tysiąc", "tysiące", "tysięcy"],
  ["milion", "miliony", "milionów"],
  ["miliard", "miliardy", "miliardów"]
];

function getVariety(number, forms) {
  if (number === 1) return forms[0];
  const lastDigit = number % 10;
  const lastTwoDigits = number % 100;
  if (lastTwoDigits >= 12 && lastTwoDigits <= 14) return forms[2];
  if (lastDigit >= 2 && lastDigit <= 4) return forms[1];
  return forms[2];
}

export function numberToWords(number, currency = "PLN") {
  if (typeof number !== "number" || Number.isNaN(number)) return "";

  const [integerPartStr, fractionalPartStr = "00"] = number.toFixed(2).split(".");
  let integerPart = parseInt(integerPartStr, 10);
  const originalInteger = integerPart;
  const words = [];

  if (integerPart === 0) {
    words.push("zero");
  } else {
    let groupIndex = 0;
    while (integerPart > 0) {
      const threeDigits = integerPart % 1000;
      if (threeDigits > 0) {
        let groupWords = [];
        const h = Math.floor(threeDigits / 100);
        const t = Math.floor((threeDigits % 100) / 10);
        const u = threeDigits % 10;

        if (h > 0) groupWords.push(hundreds[h]);

        const lastTwo = threeDigits % 100;
        if (lastTwo >= 10 && lastTwo < 20) {
          groupWords.push(teens[lastTwo - 10]);
        } else {
          if (t > 0) groupWords.push(tens[t]);
          if (u > 0 && (u !== 1 || groupIndex === 0 || threeDigits > 1)) {
            groupWords.push(units[u]);
          }
        }

        if (groupIndex > 0) {
          if (threeDigits === 1) {
            groupWords = [groups[groupIndex][0]];
          } else {
            groupWords.push(getVariety(threeDigits, groups[groupIndex]));
          }
        }

        words.unshift(groupWords.join(" "));
      }
      integerPart = Math.floor(integerPart / 1000);
      groupIndex++;
    }
  }

  const currencyWord =
    currency === "PLN"
      ? getVariety(originalInteger, ["złoty", "złote", "złotych"])
      : currency;

  return `${words.join(" ").trim()} ${currencyWord} ${fractionalPartStr.padEnd(2, "0")}/100`;
}
