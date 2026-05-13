import { franc } from "franc-min";

const ISO3_TO_NAME = {
  eng: "English",
  spa: "Spanish",
  fra: "French",
  deu: "German",
  ita: "Italian",
  por: "Portuguese",
  cmn: "Chinese",
  jpn: "Japanese",
  kor: "Korean",
  arb: "Arabic",
  rus: "Russian",
  nld: "Dutch",
  pol: "Polish",
  tur: "Turkish",
  vie: "Vietnamese",
  ind: "Indonesian",
  tha: "Thai",
  ukr: "Ukrainian",
  hin: "Hindi",
  ron: "Romanian",
  ell: "Greek",
  ces: "Czech",
  swe: "Swedish",
  dan: "Danish",
  fin: "Finnish",
  nor: "Norwegian",
  hun: "Hungarian",
  heb: "Hebrew",
  fas: "Persian",
  bul: "Bulgarian",
  cat: "Catalan"
};

const ISO3_TO_ISO1 = {
  eng: "en",
  spa: "es",
  fra: "fr",
  deu: "de",
  ita: "it",
  por: "pt",
  cmn: "zh",
  jpn: "ja",
  kor: "ko",
  arb: "ar",
  rus: "ru",
  nld: "nl",
  pol: "pl",
  tur: "tr",
  vie: "vi",
  ind: "id",
  tha: "th",
  ukr: "uk",
  hin: "hi",
  ron: "ro",
  ell: "el",
  ces: "cs",
  swe: "sv",
  dan: "da",
  fin: "fi",
  nor: "no",
  hun: "hu",
  heb: "he",
  fas: "fa",
  bul: "bg",
  cat: "ca"
};

export function detectLanguage(text) {
  if (typeof text !== "string" || text.trim().length < 10) {
    return null;
  }

  const iso3 = franc(text, { minLength: 10 });
  if (!iso3 || iso3 === "und") {
    return null;
  }

  return {
    iso3,
    iso1: ISO3_TO_ISO1[iso3] ?? null,
    name: ISO3_TO_NAME[iso3] ?? null
  };
}
