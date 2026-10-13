import type { Dict } from "@/lib/i18n";

type Text =
  | "tag"
  | "title"
  | "titleEm"
  | "lede"
  | "stepsLabel"
  | "stepDone"
  | "tabsLabel"
  | "tabFund"
  | "tabPool"
  | "openRequests"
  | "loading"
  | "loadError"
  | "removeAll"
  | "request"
  | "missing"
  | "add"
  | "remove"
  | "inList"
  | "closed"
  | "d"
  | "h"
  | "m"
  | "university"
  | "emptyTitle"
  | "emptyText"
  | "toPool"
  | "linkLabel"
  | "linkPlaceholder"
  | "linkAdd"
  | "linkHint"
  | "linkChecking"
  | "linkBad"
  | "linkNotFound"
  | "linkFunded"
  | "linkClosed"
  | "linkExpired"
  | "linkDup"
  | "linkError"
  | "own"
  | "cartLabel"
  | "cartTitle"
  | "cartEmpty"
  | "yourGift"
  | "useFull"
  | "errEmpty"
  | "errFormat"
  | "zeroSkip"
  | "itemClosed"
  | "itemFunded"
  | "total"
  | "poolChoice"
  | "poolChoiceOn"
  | "poolChoiceOff"
  | "review"
  | "reviewOne"
  | "fixFirst"
  | "connectToReview"
  | "docLabel"
  | "docTitle"
  | "failTitle"
  | "failWhy"
  | "failPool"
  | "failWallet"
  | "walletTitle"
  | "balanceLoading"
  | "deposit"
  | "fee"
  | "edit"
  | "giveNow"
  | "giving"
  | "stWaiting"
  | "stSigning"
  | "stDone"
  | "viewTx"
  | "retry"
  | "finish"
  | "finishSkip"
  | "errClosedNow"
  | "errFundedNow"
  | "connectToGive"
  | "doneLabel"
  | "doneNone"
  | "doneText"
  | "followReceipt"
  | "giveAgain"
  | "totalGiven"
  | "poolLabel"
  | "poolTitle"
  | "poolText"
  | "currency"
  | "poolNow"
  | "poolDonated"
  | "poolAllocated"
  | "poolReturned"
  | "poolLoading"
  | "poolMissing"
  | "poolErrZero"
  | "poolLine"
  | "poolFinal"
  | "poolDoneTitle"
  | "poolDoneText";

export type GiveCopy = Record<Text, string> & {
  steps: readonly [string, string, string];
  selectAll: (n: number) => string;
  jump: (n: number) => string;
  raisedOf: (raised: string, amount: string, symbol: string) => string;
  closesIn: (left: string) => string;
  linkAdded: (name: string) => string;
  removeItem: (name: string) => string;
  upTo: (amount: string, symbol: string) => string;
  errOver: (amount: string, symbol: string) => string;
  balanceOk: (have: string, symbol: string) => string;
  balanceShort: (have: string, need: string, symbol: string) => string;
  prompts: (n: number) => string;
  progress: (done: number, total: number) => string;
  errLessNow: (left: string, symbol: string) => string;
  doneTitle: (n: number) => string;
  failedNote: (n: number) => string;
  poolAmountHint: (symbol: string) => string;
};

export const T: Dict<GiveCopy> = {
  en: {
    tag: "Give",
    title: "Help a student ",
    titleEm: "finish the term.",
    lede: "Choose students whose tuition is still short, or give to the scholarship pool. Your gift is held safely until the full tuition is raised. If that doesn't happen, it goes where you choose.",
    steps: ["Choose", "Review", "Done"],
    stepsLabel: "Your progress",
    stepDone: "(done)",
    tabsLabel: "Ways to give",
    tabFund: "Fund students",
    tabPool: "Give to the scholarship pool",
    openRequests: "Students waiting for tuition",
    loading: "Looking for open tuition requests…",
    loadError: "We couldn't load the requests. We'll keep trying; check your connection.",
    selectAll: (n) => `Add all (${n})`,
    removeAll: "Remove all",
    jump: (n) => `Your list (${n})`,
    request: "request",
    raisedOf: (raised, amount, symbol) => `${raised} of ${amount} ${symbol} raised`,
    missing: "Still missing",
    add: "Add to my list",
    remove: "Remove from list",
    inList: "In your list",
    closesIn: (left) => `${left} left to give`,
    closed: "Funding closed",
    d: "d",
    h: "h",
    m: "m",
    university: "University",
    emptyTitle: "No student is waiting right now",
    emptyText:
      "Every open request is either fully funded or closed. You can still help: the scholarship pool covers the next student who comes up short.",
    toPool: "Give to the scholarship pool",
    linkLabel: "Add by tuition link",
    linkPlaceholder: "Paste the link, e.g. …/pay/7xKX…",
    linkAdd: "Add",
    linkHint:
      "Looking for a particular student? Ask the student or family for their tuition link. To protect their privacy, requests can't be searched by name or student number.",
    linkChecking: "Checking the link…",
    linkBad: "That doesn't look like a tuition link. It should contain /pay/ followed by a long code.",
    linkNotFound: "We couldn't find a tuition request at that link. Check that you copied all of it.",
    linkFunded: "This request is already fully funded. Nothing more is needed.",
    linkClosed: "This request has closed and no longer takes gifts.",
    linkExpired: "The funding deadline for this request has passed, so it no longer takes gifts.",
    linkDup: "This request is already in your list.",
    linkAdded: (name) => `Added ${name} to your list.`,
    linkError: "We couldn't check that link right now. Try again in a moment.",
    own: "Your connected wallet is the university or payout partner on this request, so it can't give to it.",
    cartLabel: "Your gifts",
    cartTitle: "To give",
    cartEmpty: "Nothing here yet. Choose a student and press “Add to my list”.",
    yourGift: "Your gift",
    upTo: (amount, symbol) => `Up to ${amount} ${symbol}, the amount still missing. You can give less.`,
    useFull: "Give the full amount",
    removeItem: (name) => `Remove ${name} from the list`,
    errEmpty: "Enter an amount.",
    errFormat: "Enter an amount like 150 or 150.50.",
    errOver: (amount, symbol) => `That's more than is missing. Enter ${amount} ${symbol} or less.`,
    zeroSkip: "0 means this one is skipped.",
    itemClosed: "Funding has closed for this request. Remove it to continue.",
    itemFunded: "Someone else completed this request. Remove it to continue.",
    total: "Total",
    poolChoice: "If a request isn't completed in time, send my gift to the scholarship pool",
    poolChoiceOn: "It will help another student whose tuition is short.",
    poolChoiceOff: "Unchecked: if a request isn't completed in time, your gift returns to your wallet.",
    review: "Review my gifts",
    reviewOne: "Review my gift",
    fixFirst: "Fix the amounts marked in red to continue.",
    connectToReview:
      "Connect a wallet with the button at the top right to review and give. You can build your list first.",
    docLabel: "Gift summary",
    docTitle: "Please check before you give",
    failTitle: "If a request isn't completed",
    failWhy:
      "That happens if it isn't fully funded by its funding deadline, the payout partner doesn't pay the university, or the scholarship committee rules for the family.",
    failPool: "Your gift goes to the scholarship pool and helps other students.",
    failWallet: "Your gift comes back to your wallet.",
    walletTitle: "Your wallet",
    balanceLoading: "Checking your balance…",
    balanceOk: (have, symbol) => `${have} ${symbol} available. Enough for these gifts.`,
    balanceShort: (have, need, symbol) =>
      `Your wallet has ${have} ${symbol}, but these gifts need ${need} ${symbol}. Lower the amounts or add ${symbol} first; gifts that don't fit will fail.`,
    deposit: "Each gift also needs a tiny network deposit in SOL from the same wallet.",
    fee: "The network also charges a tiny fee in SOL.",
    prompts: (n) =>
      n === 1
        ? "Your wallet will ask you to approve this gift."
        : `Your wallet will ask you to approve each gift separately: ${n} approvals in total.`,
    edit: "Edit",
    giveNow: "Give now",
    giving: "Giving…",
    stWaiting: "Waiting",
    stSigning: "Approve in your wallet…",
    stDone: "Given",
    viewTx: "View transaction",
    retry: "Retry",
    progress: (done, total) => `${done} of ${total} gifts sent`,
    finish: "Finish",
    finishSkip: "Finish without the failed ones",
    errClosedNow: "Funding closed for this request before your gift arrived. Nothing was taken.",
    errFundedNow: "Someone else completed this request in the meantime. Nothing was taken.",
    errLessNow: (left, symbol) =>
      `Someone else gave in the meantime: only ${left} ${symbol} is still missing, less than your gift. Nothing was taken.`,
    connectToGive: "Your wallet disconnected. Connect it again with the button at the top right.",
    doneLabel: "Thank you",
    doneTitle: (n) => (n === 1 ? "Your gift landed." : `${n} gifts landed.`),
    doneNone: "None of your gifts went through.",
    doneText:
      "Each gift is held safely until its tuition is complete. Follow any of them on its public receipt.",
    followReceipt: "Follow on the receipt",
    failedNote: (n) =>
      n === 1
        ? "1 gift didn't go through. Your money was not moved for it."
        : `${n} gifts didn't go through. Your money was not moved for those.`,
    giveAgain: "Give again",
    totalGiven: "Total given",
    poolLabel: "Scholarship pool",
    poolTitle: "Give to the scholarship pool",
    poolText:
      "The scholarship committee uses the pool to cover students whose tuition is still short as their deadline nears.",
    currency: "Currency",
    poolNow: "In the pool now",
    poolDonated: "Given by donors",
    poolAllocated: "Directed to students",
    poolReturned: "From unfinished requests",
    poolLoading: "Reading the pool…",
    poolMissing: "The pool for this currency isn't open yet. Try another currency.",
    poolAmountHint: (symbol) => `In ${symbol}. Any amount helps.`,
    poolErrZero: "Enter more than 0.",
    poolLine: "Scholarship pool",
    poolFinal: "Pool gifts are not paid back. The scholarship committee directs them to students.",
    poolDoneTitle: "Your gift is in the pool.",
    poolDoneText: "The scholarship committee will direct it to a student whose tuition is short.",
  },
  tr: {
    tag: "Bağış",
    title: "Bir öğrencinin ",
    titleEm: "dönemi tamamlamasına yardım edin.",
    lede: "Harcı hâlâ eksik olan öğrencileri seçin ya da burs havuzuna bağış yapın. Bağışınız harcın tamamı toplanana kadar güvenle bekletilir. Toplanmazsa sizin seçtiğiniz yere gider.",
    steps: ["Seç", "Kontrol et", "Tamam"],
    stepsLabel: "İlerlemeniz",
    stepDone: "(tamamlandı)",
    tabsLabel: "Bağış yolları",
    tabFund: "Öğrencilere bağış yap",
    tabPool: "Burs havuzuna bağış yap",
    openRequests: "Harç bekleyen öğrenciler",
    loading: "Açık harç talepleri aranıyor…",
    loadError: "Talepler yüklenemedi. Tekrar deniyoruz; bağlantınızı kontrol edin.",
    selectAll: (n) => `Tümünü ekle (${n})`,
    removeAll: "Tümünü çıkar",
    jump: (n) => `Listeniz (${n})`,
    request: "talep",
    raisedOf: (raised, amount, symbol) => `${raised} / ${amount} ${symbol} toplandı`,
    missing: "Eksik kalan",
    add: "Listeme ekle",
    remove: "Listeden çıkar",
    inList: "Listenizde",
    closesIn: (left) => `Toplama süresi: ${left} kaldı`,
    closed: "Toplama süresi doldu",
    d: "g",
    h: "sa",
    m: "dk",
    university: "Üniversite",
    emptyTitle: "Şu an bekleyen öğrenci yok",
    emptyText:
      "Açık taleplerin hepsi ya tamamlandı ya da kapandı. Yine de destek olabilirsiniz: burs havuzu, harcı eksik kalan bir sonraki öğrenciyi destekler.",
    toPool: "Burs havuzuna bağış yap",
    linkLabel: "Harç bağlantısıyla ekle",
    linkPlaceholder: "Bağlantıyı yapıştırın, örn. …/pay/7xKX…",
    linkAdd: "Ekle",
    linkHint:
      "Belirli bir öğrenciyi mi arıyorsunuz? Öğrenciden ya da ailesinden harç bağlantısını isteyin. Gizliliklerini korumak için talepler ad ya da öğrenci numarasıyla aranamaz.",
    linkChecking: "Bağlantı kontrol ediliyor…",
    linkBad: "Bu bir harç bağlantısına benzemiyor. Bağlantıda /pay/ ve ardından uzun bir kod olmalı.",
    linkNotFound: "Bu bağlantıda bir harç talebi bulunamadı. Bağlantının tamamını kopyaladığınızdan emin olun.",
    linkFunded: "Bu talep zaten tamamlandı. Daha fazla bağışa gerek yok.",
    linkClosed: "Bu talep kapandı, artık bağış kabul etmiyor.",
    linkExpired: "Bu talebin toplama süresi doldu, artık bağış kabul etmiyor.",
    linkDup: "Bu talep zaten listenizde.",
    linkAdded: (name) => `${name} listenize eklendi.`,
    linkError: "Bağlantı şu an kontrol edilemedi. Biraz sonra tekrar deneyin.",
    own: "Bağlı cüzdanınız bu talepte üniversite ya da ödeme ortağı; bu yüzden bu talebe bağış yapamaz.",
    cartLabel: "Bağışlarınız",
    cartTitle: "Bağış listesi",
    cartEmpty: "Henüz bir şey yok. Bir öğrenci seçip “Listeme ekle”ye basın.",
    yourGift: "Bağışınız",
    upTo: (amount, symbol) => `En fazla ${amount} ${symbol} (eksik kalan tutar). Daha azını da verebilirsiniz.`,
    useFull: "Tamamını ver",
    removeItem: (name) => `Listeden çıkar: ${name}`,
    errEmpty: "Bir tutar girin.",
    errFormat: "150 ya da 150,50 gibi bir tutar girin.",
    errOver: (amount, symbol) => `Bu, eksik kalandan fazla. En fazla ${amount} ${symbol} girin.`,
    zeroSkip: "0 girerseniz bu talep atlanır.",
    itemClosed: "Bu talebin toplama süresi doldu. Devam etmek için listeden çıkarın.",
    itemFunded: "Bu talebi başka biri tamamladı. Devam etmek için listeden çıkarın.",
    total: "Toplam",
    poolChoice: "Bir talep zamanında tamamlanmazsa bağışım burs havuzuna gitsin",
    poolChoiceOn: "Harcı eksik kalan başka bir öğrenciye destek olur.",
    poolChoiceOff: "İşaretsiz: bir talep zamanında tamamlanmazsa bağışınız cüzdanınıza geri döner.",
    review: "Özeti gör",
    reviewOne: "Özeti gör",
    fixFirst: "Devam etmek için kırmızıyla işaretli tutarları düzeltin.",
    connectToReview:
      "Özeti görmek ve bağış yapmak için sağ üstteki düğmeyle bir cüzdan bağlayın. Listenizi önceden hazırlayabilirsiniz.",
    docLabel: "Bağış özeti",
    docTitle: "Göndermeden önce kontrol edin",
    failTitle: "Bir talep tamamlanmazsa",
    failWhy:
      "Bu; talep toplama süresi içinde tamamlanmazsa, ödeme ortağı üniversiteye ödeme yapmazsa ya da burs kurulu aileden yana karar verirse olur.",
    failPool: "Bağışınız burs havuzuna gider ve başka öğrencilere destek olur.",
    failWallet: "Bağışınız cüzdanınıza geri döner.",
    walletTitle: "Cüzdanınız",
    balanceLoading: "Bakiyeniz kontrol ediliyor…",
    balanceOk: (have, symbol) => `${have} ${symbol} mevcut. Bu bağışlar için yeterli.`,
    balanceShort: (have, need, symbol) =>
      `Cüzdanınızda ${have} ${symbol} var, ancak bu bağışlar için ${need} ${symbol} gerekiyor. Tutarları azaltın ya da önce ${symbol} ekleyin; sığmayan bağışlar gerçekleşmez.`,
    deposit: "Her bağış, aynı cüzdandan küçük bir SOL ağ depozitosu da gerektirir.",
    fee: "Ağ ayrıca çok küçük bir SOL ücreti alır.",
    prompts: (n) =>
      n === 1
        ? "Cüzdanınız bu bağışı onaylamanızı isteyecek."
        : `Cüzdanınız her bağış için ayrı onay isteyecek: toplam ${n} onay.`,
    edit: "Düzenle",
    giveNow: "Bağışı gönder",
    giving: "Gönderiliyor…",
    stWaiting: "Sırada",
    stSigning: "Cüzdanınızda onaylayın…",
    stDone: "Gönderildi",
    viewTx: "İşlemi görüntüle",
    retry: "Tekrar dene",
    progress: (done, total) => `${total} bağıştan ${done} tanesi gönderildi`,
    finish: "Bitir",
    finishSkip: "Gönderilemeyenler olmadan bitir",
    errClosedNow: "Bağışınız ulaşmadan bu talebin toplama süresi doldu. Hiçbir tutar alınmadı.",
    errFundedNow: "Bu arada başka biri bu talebi tamamladı. Hiçbir tutar alınmadı.",
    errLessNow: (left, symbol) =>
      `Bu arada başka biri bağış yaptı: eksik kalan yalnızca ${left} ${symbol}, bağışınızdan az. Hiçbir tutar alınmadı.`,
    connectToGive: "Cüzdanınızın bağlantısı kesildi. Sağ üstteki düğmeyle yeniden bağlayın.",
    doneLabel: "Teşekkürler",
    doneTitle: (n) => (n === 1 ? "Bağışınız ulaştı." : `${n} bağış ulaştı.`),
    doneNone: "Bağışlarınızın hiçbiri gönderilemedi.",
    doneText:
      "Her bağış, harç tamamlanana kadar güvenle bekletilir. Her birini herkese açık makbuzundan takip edebilirsiniz.",
    followReceipt: "Makbuzdan takip et",
    failedNote: (n) =>
      n === 1
        ? "1 bağış gönderilemedi. Bunun için paranız hareket etmedi."
        : `${n} bağış gönderilemedi. Bunlar için paranız hareket etmedi.`,
    giveAgain: "Yeniden bağış yap",
    totalGiven: "Toplam bağış",
    poolLabel: "Burs havuzu",
    poolTitle: "Burs havuzuna bağış yap",
    poolText:
      "Burs kurulu havuzu, toplama süresi yaklaşan ve harcı hâlâ eksik olan öğrencileri desteklemek için kullanır.",
    currency: "Para birimi",
    poolNow: "Şu an havuzda",
    poolDonated: "Bağışçılardan gelen",
    poolAllocated: "Öğrencilere aktarılan",
    poolReturned: "Tamamlanmayan taleplerden gelen",
    poolLoading: "Havuz okunuyor…",
    poolMissing: "Bu para birimi için havuz henüz açılmadı. Başka bir para birimi deneyin.",
    poolAmountHint: (symbol) => `${symbol} cinsinden. Her tutar değerlidir.`,
    poolErrZero: "0'dan büyük bir tutar girin.",
    poolLine: "Burs havuzu",
    poolFinal: "Havuz bağışları geri ödenmez. Burs kurulu bunları öğrencilere yönlendirir.",
    poolDoneTitle: "Bağışınız havuzda.",
    poolDoneText: "Burs kurulu bunu harcı eksik kalan bir öğrenciye yönlendirecek.",
  },
};
