import type { Locale } from "@/shared/i18n";

type Text = { ru: string; en: string };

type TopicDef = {
  id: string;
  title: Text;
  detail: Text;
  href?: string;
};

type StageDef = {
  id: string;
  index: string;
  title: Text;
  when: Text;
  summary: Text;
  source: { label: Text; href: string; note: Text };
  practice: { label: Text; href: string; note: Text };
  topics: TopicDef[];
};

const stages: StageDef[] = [
  {
    id: "base",
    index: "01",
    title: { ru: "База", en: "Base" },
    when: { ru: "Недели 1-4", en: "Weeks 1-4" },
    summary: {
      ru: "Один учебник на весь этап. Из него собираешь схему: путь запроса, кто имеет право на действие, какая запись в журнале это доказывает. Лаборатории одни, путь Pre-Security.",
      en: "One book for the whole stage. From it you build a map: the request path, who may act, and which log line proves it. One lab path: Pre-Security.",
    },
    source: {
      label: {
        ru: "Defensive Security Handbook",
        en: "Defensive Security Handbook",
      },
      href: "https://www.oreilly.com/library/view/defensive-security-handbook/9781098127237/",
      note: {
        ru: "Brotherston, Berlin, Reyor. 2-е издание, 2024. Единственная книга этапа.",
        en: "Brotherston, Berlin, Reyor. 2nd edition, 2024. The only book for this stage.",
      },
    },
    practice: {
      label: { ru: "TryHackMe Pre-Security", en: "TryHackMe Pre-Security" },
      href: "https://tryhackme.com/path/outline/presecurity",
      note: {
        ru: "Один путь, около 19 часов. Комнаты этого пути, не чужие системы.",
        en: "One path, about 19 hours. Rooms on this path, not other people's systems.",
      },
    },
    topics: [
      {
        id: "base-path",
        title: {
          ru: "Путь запроса",
          en: "Request path",
        },
        detail: {
          ru: "DNS, порт, TLS. Выписать, что при обычном HTTPS видно снаружи (адреса, имя, размеры) и что закрыто. Проверить на своём визите в Wireshark.",
          en: "DNS, port, TLS. Write down what normal HTTPS still shows (addresses, name, sizes) and what is closed. Check it on your own visit in Wireshark.",
        },
      },
      {
        id: "base-auth",
        title: { ru: "Вход и право", en: "Login and permission" },
        detail: {
          ru: "Фактор, сессия, отзыв сессии. Право на действие отдельно от факта входа. Включить второй фактор на своих аккаунтах и выписать, кто там администратор.",
          en: "Factor, session, revoking a session. Permission to act is separate from being logged in. Turn on a second factor on your own accounts and note who is admin.",
        },
      },
      {
        id: "base-log",
        title: { ru: "Запись входа", en: "Login record" },
        detail: {
          ru: "На своей ВМ Ubuntu войти вторым пользователем и найти запись: время, кто, откуда, результат. Выписать поля, которых не хватило бы при разборе.",
          en: "On your own Ubuntu VM, log in as a second user and find the record: time, who, from where, result. Note the fields you would still be missing.",
        },
      },
      {
        id: "base-unix",
        title: { ru: "Права на файл", en: "File permissions" },
        detail: {
          ru: "Учебный файл со словом «секрет». Второй пользователь на той же ВМ читать его не может. Это та же модель, что потом будет у роли в облаке.",
          en: "A practice file that says secret. A second user on the same VM cannot read it. That is the same model a cloud role will use later.",
        },
      },
      {
        id: "base-map",
        title: { ru: "Схема и путь", en: "Map and path" },
        detail: {
          ru: "Одна страница: вход, идентичность, данные, журнал, контроль на каждой стрелке. Pre-Security дойти до конца и дописать в схему только то, что без комнаты не понимал.",
          en: "One page: entry, identity, data, log, and the control on each arrow. Finish Pre-Security and add to the map only what you could not explain before a room.",
        },
      },
    ],
  },
  {
    id: "cloud",
    index: "02",
    title: { ru: "Облако", en: "Cloud" },
    when: { ru: "Недели 5-10", en: "Weeks 5-10" },
    summary: {
      ru: "Одна книга про устройство облачной защиты и один лабораторный путь по AWS: роли, сеть, данные, журнал. Второе облако не открывать, пока документ по этому контуру не готов.",
      en: "One book on how cloud security is built, and one AWS lab path: roles, network, data, logs. Do not open a second cloud until the write-up for this account exists.",
    },
    source: {
      label: { ru: "Practical Cloud Security", en: "Practical Cloud Security" },
      href: "https://www.oreilly.com/library/view/practical-cloud-security/9781098148164/",
      note: {
        ru: "Chris Dotson, 2-е издание, 2023. Единственная книга этапа.",
        en: "Chris Dotson, 2nd edition, 2023. The only book for this stage.",
      },
    },
    practice: {
      label: { ru: "TryHackMe Defending AWS", en: "TryHackMe Defending AWS" },
      href: "https://tryhackme.com/path/outline/defendingaws",
      note: {
        ru: "Один путь: закрывать типичные ошибки IAM, сети и данных в учебном AWS.",
        en: "One path: close typical IAM, network, and data mistakes in a practice AWS account.",
      },
    },
    topics: [
      {
        id: "cloud-root",
        title: { ru: "Корень и граница", en: "Root and the boundary" },
        detail: {
          ru: "Своими словами: что закрывает провайдер и что закрываешь ты. MFA на корне. Дальше работать отдельной учёткой, корневые ключи не создавать.",
          en: "In your own words: what the provider closes and what you close. MFA on the root. Work from a separate user after that. Do not create root keys.",
        },
      },
      {
        id: "cloud-roles",
        title: { ru: "Три роли и отказ", en: "Three roles and a denial" },
        detail: {
          ru: "Админ для учёбы, роль только на чтение журнала, роль приложения без права менять IAM. От узкой роли поймать запрещённое действие и сохранить текст отказа.",
          en: "An admin for study, a log-read role, and an app role that cannot change IAM. From the narrow role, hit a forbidden action and save the denial.",
        },
      },
      {
        id: "cloud-net",
        title: { ru: "Админский порт закрыт", en: "Admin port stays closed" },
        detail: {
          ru: "Частная подсеть. Правило «весь интернет на админский порт» не оставлять. Проверить снаружи, что закрытый порт не отвечает.",
          en: "A private subnet. Do not leave the whole internet on the admin port. From outside, confirm the closed port does not answer.",
        },
      },
      {
        id: "cloud-secret",
        title: { ru: "Секрет в менеджере", en: "Secret in the manager" },
        detail: {
          ru: "Учебное значение только в менеджере секретов. Читает одна роль. Вторая получает отказ. В репозиторий значение не попадает.",
          en: "The practice value lives only in the secrets manager. One role can read it. The second is denied. The value never enters the repo.",
        },
      },
      {
        id: "cloud-trail",
        title: { ru: "Событие в журнале", en: "Event in the log" },
        detail: {
          ru: "Журнал админских действий на весь аккаунт. Создать учебного пользователя и найти это событие. Роль приложения не может стереть хранилище журнала.",
          en: "Admin activity log on the whole account. Create a practice user and find that event. The app role cannot delete the log store.",
        },
      },
      {
        id: "cloud-doc",
        title: { ru: "Документ контура", en: "Account write-up" },
        detail: {
          ru: "2-3 страницы: схема, три роли и что каждой нельзя, что видно из интернета, где секрет, где журнал. Каждая фраза сверяется с консолью.",
          en: "2-3 pages: map, three roles and what each cannot do, what is visible from the internet, where the secret is, where the log is. Every sentence matches the console.",
        },
      },
    ],
  },
  {
    id: "exposure",
    index: "03",
    title: { ru: "Доступ и риск", en: "Access and risk" },
    when: { ru: "Недели 11-14", en: "Weeks 11-14" },
    summary: {
      ru: "Один документ: CIS Controls v8. Одно задание: каталог CISA KEV по своему софту. Список активов, лишние права, что чинить первым.",
      en: "One document: CIS Controls v8. One assignment: the CISA KEV catalog against your own software. Asset list, extra permissions, what to fix first.",
    },
    source: {
      label: { ru: "CIS Controls v8", en: "CIS Controls v8" },
      href: "https://www.cisecurity.org/controls/v8",
      note: {
        ru: "Единственный текст этапа. Контроли 1-7 читаешь по своему списку, не как плакат.",
        en: "The only text for this stage. Read controls 1-7 against your own list, not as a poster.",
      },
    },
    practice: {
      label: { ru: "CISA KEV", en: "CISA KEV" },
      href: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog",
      note: {
        ru: "Пять записей каталога. Решение: обновить, закрыть доступ или не применимо.",
        en: "Five catalog entries. Decision: update, close access, or not applicable.",
      },
    },
    topics: [
      {
        id: "exp-assets",
        title: { ru: "Инвентарь с владельцем", en: "Inventory with an owner" },
        detail: {
          ru: "Аккаунт, ВМ, диски, домены, секреты, учётки, сервисы, куда ты уже залогинен. У каждой строки живой владелец. Пустой владелец значит, что строка не закрыта.",
          en: "Account, VM, disks, domains, secrets, users, and services you already log into. Every row has a living owner. An empty owner means the row is not done.",
        },
      },
      {
        id: "exp-rights",
        title: { ru: "Лишнее право снято", en: "One extra right removed" },
        detail: {
          ru: "По каждой роли: зачем она и какое действие ей не нужно. Снять хотя бы одно и проверить, что её учебный сценарий ещё работает.",
          en: "For each role: why it exists and which action it does not need. Remove at least one and confirm its practice task still works.",
        },
      },
      {
        id: "exp-kev",
        title: { ru: "Пять записей KEV", en: "Five KEV entries" },
        detail: {
          ru: "Софт своей ВМ и сервисы аккаунта. Пять близких записей каталога. По каждой: касается или нет, и что сделать. Воспроизводить дыру не нужно.",
          en: "Software on your VM and services in the account. Five nearby catalog entries. For each: it applies or it does not, and what to do. Reproducing the bug is not the task.",
        },
      },
      {
        id: "exp-vendors",
        title: { ru: "Пять поставщиков", en: "Five providers" },
        detail: {
          ru: "Облако, почта, гит и ещё два реальных сервиса. По каждому: какие данные, как отозвать доступ сегодня, где журнал, кого звать если утекло у них.",
          en: "Cloud, mail, git, and two more real services. For each: which data, how to revoke access today, where the log is, who to call if they leak.",
        },
      },
      {
        id: "exp-order",
        title: { ru: "Порядок починки", en: "Fix order" },
        detail: {
          ru: "Короткий список по своему контуру: снаружи или рядом с секретом сначала, внутреннее без данных потом. Список лежит рядом с инвентарём.",
          en: "A short list for your own account: exposed items and items next to a secret first, internal items without data later. The list sits next to the inventory.",
        },
      },
    ],
  },
  {
    id: "ai",
    index: "04",
    title: { ru: "Безопасность ИИ", en: "AI security" },
    when: { ru: "Недели 15-19", en: "Weeks 15-19" },
    summary: {
      ru: "Один документ на весь этап: OWASP Top 10 for LLM. Он же список заданий. Прототип свой, ключ в менеджере секретов из облачного этапа.",
      en: "One document for the whole stage: the OWASP Top 10 for LLM. It is also the assignment list. The prototype is yours. The key stays in the secrets manager from the cloud stage.",
    },
    source: {
      label: { ru: "OWASP Top 10 for LLM", en: "OWASP Top 10 for LLM" },
      href: "https://owasp.org/www-project-top-10-for-large-language-model-applications/",
      note: {
        ru: "Единственный текст. Читаешь определения и последствия, затем отмечаешь по своему прототипу: закрыто или не применимо.",
        en: "The only text. Read the definitions and the impact, then mark your own prototype: closed or not applicable.",
      },
    },
    practice: {
      label: { ru: "Тот же список, как чеклист", en: "The same list, as a checklist" },
      href: "https://genai.owasp.org/llm-top-10/",
      note: {
        ru: "Актуальная страница списка. Напротив каждого пункта одна строка про свой прототип.",
        en: "The current list page. One line per item about your own prototype.",
      },
    },
    topics: [
      {
        id: "ai-map",
        title: { ru: "Схема системы", en: "System map" },
        detail: {
          ru: "Пользователь, твой код, провайдер модели, данные, инструменты. Действие выполняет код, если он решил послушать модель. Текст инструкции защитой не считается.",
          en: "User, your code, the model provider, data, tools. An action runs only if your code chooses to obey the model. Instruction text does not count as a control.",
        },
      },
      {
        id: "ai-data",
        title: { ru: "Политика данных", en: "Data policy" },
        detail: {
          ru: "Страница: что прототипу можно отправлять. Учебный текст можно. Чужие персональные данные и боевые ключи нельзя. Секрет не попадает в запрос и в твой журнал.",
          en: "One page: what the prototype may send. Practice text is allowed. Other people's personal data and live keys are not. A secret does not land in the request or in your log.",
        },
      },
      {
        id: "ai-tools",
        title: { ru: "Два инструмента", en: "Two tools" },
        detail: {
          ru: "Первый читает один файл из разрешённого каталога и отказывает вне его. Второй изображает отправку и ждёт подтверждения из твоего интерфейса, не из ответа модели.",
          en: "The first reads one file from an allowed folder and refuses anything outside it. The second pretends to send and waits for a confirmation from your UI, not from the model reply.",
        },
      },
      {
        id: "ai-pin",
        title: { ru: "Версия и шаблон", en: "Version and template" },
        detail: {
          ru: "Идентификатор модели зафиксирован в конфиге. Шаблон в репозитории без ключей. Ключ только как имя секрета в менеджере.",
          en: "The model id is pinned in config. The template is in the repo with no keys. The key appears only as a secret name in the manager.",
        },
      },
      {
        id: "ai-doc",
        title: { ru: "Документ против списка", en: "Write-up against the list" },
        detail: {
          ru: "3-4 страницы: владелец, данные, версия, инструменты, журнал, как отозвать роль секрета. Пункт списка без соответствия в коде вычёркивается.",
          en: "3-4 pages: owner, data, version, tools, log, how to revoke the secret's role. A list item with nothing in the code gets crossed out.",
        },
      },
    ],
  },
  {
    id: "anon",
    index: "05",
    title: { ru: "Анонимность", en: "Anonymity" },
    when: { ru: "Недели 20-21", en: "Weeks 20-21" },
    summary: {
      ru: "Один сайт на весь этап: Surveillance Self-Defense от EFF. Это бытовая и рабочая приватность: от кого ты закрываешься, что тебя всё равно связывает, и где анонимность заканчивается.",
      en: "One site for the whole stage: EFF Surveillance Self-Defense. Everyday and work privacy: who you are closing yourself from, what still links you, and where anonymity stops.",
    },
    source: {
      label: { ru: "Surveillance Self-Defense", en: "Surveillance Self-Defense" },
      href: "https://ssd.eff.org/",
      note: {
        ru: "Единственный текст. Модули ниже это главы того же сайта, не новые книги.",
        en: "The only text. The modules below are chapters of the same site, not extra books.",
      },
    },
    practice: {
      label: { ru: "Свой план безопасности", en: "Your security plan" },
      href: "https://ssd.eff.org/module/your-security-plan/",
      note: {
        ru: "Шесть вопросов EFF, ответы про тебя, на одну страницу.",
        en: "The six EFF questions, answered about you, on one page.",
      },
    },
    topics: [
      {
        id: "anon-plan",
        title: { ru: "План на одну страницу", en: "A one-page plan" },
        detail: {
          ru: "Что защищаешь, от кого, насколько плох провал, насколько он вероятен, сколько усилий готов потратить, кто союзник. Без этого остальные модули не к чему крепить.",
          en: "What you protect, from whom, how bad failure is, how likely it is, how much effort you will spend, who your allies are. The other modules have nothing to attach to until this exists.",
        },
        href: "https://ssd.eff.org/module/your-security-plan/",
      },
      {
        id: "anon-link",
        title: { ru: "Что сводит тебя в одну личность", en: "What ties you into one person" },
        detail: {
          ru: "Аккаунт, устройство, платёж, постоянный браузер, вход в обычную почту. Выписать три своих привычки, которые связывают учебный контур с основной жизнью.",
          en: "Account, device, payment, a long-lived browser, signing into everyday mail. Write down three of your habits that tie a practice setup to your main life.",
        },
        href: "https://ssd.eff.org/module/choosing-your-tools",
      },
      {
        id: "anon-vpn",
        title: { ru: "Что делает VPN и кому ты после этого доверяешь", en: "What a VPN does, and who you trust after" },
        detail: {
          ru: "VPN уводит трафик в другую сеть. Провайдер VPN этот трафик видит. Реклама «полной анонимности» к делу не относится. Записать, нужен ли он твоему плану или нет.",
          en: "A VPN moves traffic onto another network. The VPN provider can see that traffic. Ads about total anonymity are beside the point. Write down whether your plan needs one.",
        },
        href: "https://ssd.eff.org/module/vpn",
      },
      {
        id: "anon-tor",
        title: { ru: "Что делает Tor и что его обнуляет", en: "What Tor does, and what cancels it" },
        detail: {
          ru: "По гайду EFF: браузер гонит через Tor только свой трафик. Вход в обычный аккаунт и файл, открытый уже вне браузера, возвращают обычный адрес. Записать эти два предела своими словами.",
          en: "From the EFF guide: the browser sends only its own traffic through Tor. Signing into an everyday account, or opening a downloaded file outside the browser, brings back your ordinary address. Write those two limits in your own words.",
        },
        href: "https://ssd.eff.org/module/how-to-use-tor",
      },
      {
        id: "anon-meta",
        title: { ru: "Метаданные и потолок", en: "Metadata and the ceiling" },
        detail: {
          ru: "Кто, когда, откуда и с кем. Это остаётся, даже когда текст закрыт. В конце плана одной фразой: какого уровня ты добиваешься и чего этот уровень не даёт.",
          en: "Who, when, from where, and with whom. That remains even when the text is closed. End the plan with one sentence: which level you are aiming for, and what that level does not give you.",
        },
        href: "https://ssd.eff.org/module/why-metadata-matters",
      },
    ],
  },
];

const ui = {
  ru: {
    eyebrow: "Скрытый контур",
    title: "Четыре часа в день",
    lead: "21 неделя. На этап один текст и одно место практики. Галочка закрывает тему. Когда темы блока кончились, блок сам складывается.",
    back: "К дню",
    read: "Текст",
    practice: "Практика",
    done: "Блок закрыт",
    reopen: "Открыть",
    fold: "Сложить блок",
    reset: "Сбросить галочки",
    resetArmed: "Нажми ещё раз, чтобы стереть",
    of: "из",
    day: [
      { k: "70 мин", v: "Текст этапа, абзац своими словами" },
      { k: "140 мин", v: "Практика этапа, только своё" },
      { k: "30 мин", v: "Что не сошлось с текстом" },
    ],
  },
  en: {
    eyebrow: "Hidden track",
    title: "Four hours a day",
    lead: "21 weeks. One text and one practice place per stage. A check closes a topic. When the topics in a block are done, the block folds itself.",
    back: "Back to day",
    read: "Text",
    practice: "Practice",
    done: "Block closed",
    reopen: "Open",
    fold: "Fold block",
    reset: "Reset checks",
    resetArmed: "Click again to erase",
    of: "of",
    day: [
      { k: "70 min", v: "The stage text, then a paragraph in your own words" },
      { k: "140 min", v: "The stage practice, on your own systems" },
      { k: "30 min", v: "What did not match the text" },
    ],
  },
} as const;

export type ContourCopy = {
  eyebrow: string;
  title: string;
  lead: string;
  back: string;
  read: string;
  practice: string;
  done: string;
  reopen: string;
  fold: string;
  reset: string;
  resetArmed: string;
  of: string;
  day: { k: string; v: string }[];
  stages: {
    id: string;
    index: string;
    title: string;
    when: string;
    summary: string;
    source: { label: string; href: string; note: string };
    practice: { label: string; href: string; note: string };
    topics: { id: string; title: string; detail: string; href?: string }[];
  }[];
};

function pick(text: Text, locale: Locale) {
  return text[locale];
}

export function contourCopy(locale: Locale): ContourCopy {
  const strings = ui[locale];
  return {
    ...strings,
    day: strings.day.map((item) => ({ k: item.k, v: item.v })),
    stages: stages.map((stage) => ({
      id: stage.id,
      index: stage.index,
      title: pick(stage.title, locale),
      when: pick(stage.when, locale),
      summary: pick(stage.summary, locale),
      source: {
        label: pick(stage.source.label, locale),
        href: stage.source.href,
        note: pick(stage.source.note, locale),
      },
      practice: {
        label: pick(stage.practice.label, locale),
        href: stage.practice.href,
        note: pick(stage.practice.note, locale),
      },
      topics: stage.topics.map((topic) => ({
        id: topic.id,
        title: pick(topic.title, locale),
        detail: pick(topic.detail, locale),
        href: topic.href,
      })),
    })),
  };
}
