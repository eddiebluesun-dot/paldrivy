import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import pt from '../../locales/pt.json';
import en from '../../locales/en.json';
import enGB from '../../locales/en-GB.json';
import es from '../../locales/es.json';
import fr from '../../locales/fr.json';
import zh from '../../locales/zh.json';

const device = Localization.getLocales()[0];
const lc = device?.languageCode ?? 'en';
const rc = device?.regionCode ?? '';
const tag = device?.languageTag ?? '';

// Mirrors detectLang in autoLocale.ts — kept inline to avoid circular imports at bundle init
const PT_RC = new Set(['BR','PT','AO','MZ','CV','GW','ST','TL']);
const ES_RC = new Set(['MX','CO','AR','PE','VE','CL','EC','GT','CU','BO','DO','HN','PY','SV','NI','CR','PA','UY','GQ','ES']);
const EN_GB_RC = new Set(['GB','AU','NZ','IE','ZA','NG','GH','KE','UG','TZ','ZM','ZW','BW','NA','MW','LS','SZ','SG','MY','IN','PK','BD','LK','NP','PG','FJ','WS','TO','VU','SB','JM','TT','BB','PH']);
const FR_RC = new Set(['FR','BE','CH','LU','MC','CI','SN','CM','CD','MG','ML','BF','NE','TG','BJ','GA','CG','MR','DJ','KM','SC','BI','RW','MU','RE','GP','MQ','GF','PM','WF','PF','NC']);
const ZH_RC = new Set(['CN','TW','HK','MO','SG']);

const defaultLng: string =
  (PT_RC.has(rc) || lc === 'pt')    ? 'pt' :
  (ES_RC.has(rc) || lc === 'es')    ? 'es' :
  (FR_RC.has(rc) || lc === 'fr')    ? 'fr' :
  (ZH_RC.has(rc) || lc === 'zh')    ? 'zh' :
  (tag.startsWith('en-GB') || EN_GB_RC.has(rc)) ? 'en-GB' :
  (lc === 'en')                      ? 'en' :
  'en';

i18n.use(initReactI18next).init({
  resources: {
    pt:    { translation: pt },
    en:    { translation: en },
    'en-GB': { translation: { ...en, ...enGB } },
    es:    { translation: es },
    fr:    { translation: fr },
    zh:    { translation: zh },
  },
  lng: defaultLng,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
