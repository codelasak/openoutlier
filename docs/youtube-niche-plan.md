# YouTube: niş takibi, kendi kanal geçmişi ve NexLev'in yerine geçecek özellikler — plan

**Amaç.** NexLev eklentisini kaldırabilmek. Bunun için üç şey gerekiyor:

1. **Seçtiğimiz nişteki kanalları sürekli takip etmek.** Yeni yüklenen videoların ilk saatlerden itibaren ne kadar hızlı büyüdüğünü kaydedip bundan içgörü çıkarmak.
2. **Kendi kanal verilerimizi (Studio / YouTube Analytics) her gün kaydetmek.** Böylece zaman içindeki ilerleme görünür.
3. **NexLev'in yaptığı, kendi başımıza yapabildiğimiz her şeyi eklemek.** Her özellik paneldeki **Özellikler** sekmesinden açılıp kapatılabilsin.

Kaynaklar:
- NexLev v3.11.5 kodu: `~/Desktop/fenext/pentests/nexlev-patched/`. Formüller oradan doğrulandı.
- Canlı eklenti, Chrome'da gözlemlendi (2026-11-21).
- NexLev'in dokümanları.
- Üçüncü parti API'lerin fiyat araştırması (bölüm 8).

## 1. Kararlar

| Konu | Karar | Neden |
|---|---|---|
| Sürekli takip nerede çalışır | **Bridge** (`mcp/bridge-daemon.mjs`, launchd ile hep açık). Yeni dosya `mcp/tracker.mjs`. | Chrome kapalıyken de çalışmalı. Bridge zaten hep açık ve SQLite'a yazıyor. |
| Yeni video ve erken izlenme | Kanalın **RSS akışları**, 15 dakikada bir: `feeds/videos.xml?playlist_id=UULF…` (sadece uzun videolar) ve `UUSH…` (sadece Shorts). Kota harcamaz, API anahtarı gerektirmez. | 2026-11-21'de test edildi: her akış 15 video veriyor. Video başına başlık, yayın zamanı, thumbnail, **izlenme** (`media:statistics views`) ve **beğeni** (`media:starRating count`) var. Haftada bir video yükleyen bir kanalda 15 video ~4 ay eder; hız eğrisi için gereken pencereden fazlası. |
| Kesin sayılar ve ek alanlar | **YouTube Data API `videos.list`** (50 video = 1 birim): yorum sayısı, süre, etiketler, kategori. RSS'te bunlar yok. | Ucuz ve resmi, ama rakip istatistikleri için 30 gün kuralı var (bir alt satır). |
| **YouTube API politikası** | **Her şey saklanır** (kullanıcının kararı, 2026-11-21). Bunun için bir ayar var: `api-retention-30d`, "Rakiplerin API verisini 30 günde sil". Varsayılan kapalı; açılırsa `source='api'` ve `mine=0` olan satırlar 30 günden sonra silinir, uzun geçmiş RSS ve sayfa ölçümlerinden devam eder. Her ölçüm satırında kaynağı (`source`) tutulduğu için bu sonradan da açılabilir. | YouTube Developer Policies §III.E.4.b, yetkisiz veriden gelen istatistiklerin 30 günden fazla saklanmasını yasaklıyor. §III.E.4.h, bunlardan türetilmiş metrik üretilmesini yasaklıyor. Risk kabul edildi: tek kişilik özel bir araç; en kötü ihtimalle API anahtarı ya da Google Cloud projesi kapatılır, yenisi açılır. Anahtar ayrı bir Google Cloud projesinde tutulur, böylece OAuth istemcisi etkilenmez. |
| API anahtarı | Bridge için `~/.openoutlier/youtube-api-key` (yalnız kullanıcı okuyabilir) ya da `OPENOUTLIER_YOUTUBE_API_KEY`. Eklentideki anahtar tek tıkla bridge'e kopyalanabilir. | Arka plan işleri tarayıcıya bağlı kalmasın. |
| Kendi kanal verisi | **YouTube Analytics API** (bağlantı zaten var). NexLev gibi Studio sayfası okumak (DOM scraping) yok. | Resmi, geçmişe dönük doldurulabiliyor (kanalın ilk gününe kadar), Studio'nun arayüz değişikliklerinden etkilenmiyor. Veri sadece bu Mac'te kalıyor. |
| Outlier formülü | **İkisi birden**: medyan (bizim, varsayılan) ve ortalama (NexLev: izlenme ÷ toplam izlenme/video sayısı). Ayardan seçilir. | NexLev kullanıcısı aynı sayıyı görmek isteyebilir. Ortalama hit videolarla şişer. |
| VPH | İki değer: **ömür boyu VPH** (NexLev ile aynı: izlenme ÷ yayından beri geçen saat) ve takip edilen videolarda **son 24 saatin VPH'si** (iki anlık değerin farkından). | "Şu an ne kadar hızlı" sorusunu ancak gerçek ölçümler cevaplar. |
| Monetization kontrolü | NexLev'in yöntemi: watch sayfası HTML'inde `"yt_ad"` anahtarı. **Açık başlar** (kullanıcının kararı). İstekler sırayla atılır, en fazla dakikada 10; sonuç 7 gün önbellekte kalır. | YouTube'a kendi isteğimizi attığımız ilk özellik. README'deki "kendi isteğimizi atmayız" sözü bu ayar için istisna olarak güncellenir ve ayarın nasıl kapatılacağı yazılır. |
| Özellik aç/kapa | `rs:settings.features` (chrome.storage). Bridge işleri aynı listeyi `/settings` üzerinden alır ve `meta` tablosunda tutar. | Tek bir kaynak. Panel, Library ve bridge aynı anahtarlara bakar. |
| Yapay zekâ gerektiren işler | Yorum duygu analizi, transcript özeti, "faceless" kontrolü, niş raporu: **Claude, MCP üzerinden**. Eklentiye AI anahtarı konmaz. | Ek maliyet yok, veri dışarı gitmez. Claude aboneliği zaten var. |
| Kitle kaynaklı veri | **Yok.** Hiçbir veri bizim veya başkasının sunucusuna gitmez. | NexLev'in veritabanı kullanıcıların gezdiği kanallardan, aramalarından ve Studio verilerinden besleniyor. Bizim farkımız bu. |

## 2. Niş takibi ve hız (velocity) içgörüleri: 1. öncelik

### 2.1 Takip listesi
- Library'de bir klasör ya da etiket **"Takip edilen niş"** olarak işaretlenir, örneğin "Excel". İçindeki YouTube kanalları otomatik takibe girer.
- **Başlangıç listesi (karar, 2026-11-21):** kütüphanedeki Excel kanalları "Excel" klasörüne taşınır ve takibe girer. Bunlar:
  - Simon Sez IT, Excel Dictionary, Kevin Stratvert, Leila Gharani, MyOnlineTrainingHub
  - Kenji Explains, Excel Campus, Learn Skills Daily, Easy Click Learning, Excel Champs
  - Cody Baldwin, Excel Champion, Marg Analytics, Bright Minds Hub, Technology for Teachers and Students
  - ve **Hands on Excel** (`mine`).

  Starter Story, Vedakarna, Yeraltı, Omar & Hana, VitaminCM ve Jake Trinder Excel dışı oldukları için girmez. Niş radarı yeni adayları önerir.
- Kanal sayfasında **"Takip et"** butonu kanalı bu listeye ekler.
- Bir kanal takibe girince bir kerelik **geçmiş doldurma** yapılır: "All uploads via API" zaten var (son 500 yükleme, kesin sayılarla). Bu, kanalın geçmiş videolarının bugünkü izlenmesini verir ama büyüme eğrisini vermez. Eğri, takip başladıktan sonra yüklenen videolar için oluşur.
- Kendi kanalım (`mine: true`) da aynı listeye girer. Kendi videolarım nişin eğrisiyle aynı ölçüde karşılaştırılır.

### 2.2 Ölçüm takvimi (`mcp/tracker.mjs`)

**Ana kaynak RSS.** Her kanalın iki akışı (uzun ve Shorts) 15 dakikada bir okunur. Akıştaki 15'er videonun izlenme ve beğenisi `video_stats`'a `source='rss'` olarak yazılır. Bu bedava, kota harcamaz ve politika sınırına takılmaz. Ek olarak **Data API** şu takvimle çalışır:

| Videonun yaşı | API ölçüm sıklığı |
|---|---|
| 0–48 saat | **saatte bir** (ilk 6 saatte 30 dakikada bir, ayardan) |
| 2–7 gün | 6 saatte bir |
| 7–30 gün | günde bir |
| 30 gün+ | haftada bir |
| Kanal istatistikleri (abone, toplam izlenme, video sayısı) | günde bir (`channels.list`, 50 kanal = 1 birim). Bugünden itibaren rakiplerin kendi Social Blade grafiğimiz olur. Takip öncesi geçmiş istenirse Social Blade'den bir kerelik alınabilir (bölüm 8; şimdilik bütçe $0). |

**Faz 0'da doğrulanacak:** RSS'teki izlenme sayısı ne kadar gecikmeli güncelleniyor? Bir gün boyunca RSS ve API saatlik karşılaştırılır. Gecikme 1 saatten fazlaysa ilk 48 saatte API ağırlık kazanır.

**Kota hesabı.** 100 kanal, kanal başına haftada ~1 video, kanal başına ~300 eski video varsayımıyla günlük Data API tüketimi:

| İş | Birim/gün |
|---|---|
| İlk 48 saatteki ~30 video, saatte bir | 24 |
| 2–7 günlük ~75 video, 6 saatte bir | 8 |
| 7–30 günlük ~350 video, günde bir | 7 |
| Eski arşiv (~30.000 video), haftada bir | ~86 |
| Kanal istatistikleri | 2 |
| **Toplam** | **~130** |

Bedava kota günde 10.000 birim; bu %1,3 ediyor. 500 kanal bile rahat sığar. Kalan kota, nişte arama (bölüm 6.5) ve yorumlar için kullanılır. Kota sayacı zaten var (`rs:yt-api-quota`, MCP tarafında `bridge_status`).

**Veritabanı (yeni tablolar, `store.mjs` migration):**
```sql
tracked_channels (channel_id PK, account_id, niche, mine INTEGER, added_at, rss_checked_at, active INTEGER)
video_stats      (video_id, ts, views, likes, comments, source TEXT /* api|rss|page */, PRIMARY KEY (video_id, ts))
video_meta_log   (video_id, ts, title, thumb_hash, duration, PRIMARY KEY (video_id, ts))  -- başlık / thumbnail değişince
channel_stats    (channel_id, day TEXT, subs, views, videos, PRIMARY KEY (channel_id, day))
tracker_jobs     (video_id PK, channel_id, published_at, next_at, tier)
```
Mevcut `snapshots` tablosu eklentiden gelen sayfa verisiyle dolmaya devam eder. Tracker kendi ölçümlerini `video_stats`'a yazar; ikisi grafikte birleşir.

### 2.3 Hesaplanan metrikler
- **Kontrol noktaları:** her video için 1, 3, 6, 12, 24, 48, 72 saat ve 7, 14, 30 gündeki izlenme. Ölçümler arası değerler doğrusal ara değerle (interpolasyon) bulunur.
- **Kanalın normal eğrisi:** kanalın takip edilen videolarının her kontrol noktasındaki **medyanı**. Shorts ve uzun video ayrı tutulur. En az 5 video olana kadar nişin eğrisi, kanalın medyanına ölçeklenerek kullanılır.
- **Hız skoru:** `izlenme(t) ÷ kanalın medyanı(t)`. Örnek: "24. saatte 3,4×".
- **Abone başına izlenme:** `izlenme(48s) ÷ abone`. Küçük ve büyük kanalları adil karşılaştırmak için.
- **Erken uyarı:** 6. veya 24. saatte hız skoru ≥ 3× (ayarlanabilir) olunca Chrome bildirimi ve Library'deki **"Hızlı yükselenler"** akışı. `notifications` izni zaten var.
- **Evergreen / patlama sınıfı:** `izlenme(30g) ÷ izlenme(48s)`. Yüksekse arama trafiğiyle uzun süre büyüyen bir video, düşükse ilk günlerde patlayıp sönen bir video.
- **Başlık / thumbnail değişikliği:** RSS her okumada başlığı ve thumbnail'i getirir (son 15 video; daha eskiler için haftalık `videos.list`). Thumbnail'in perceptual hash'i saklanır, çünkü adres aynı kalıp görsel değişebiliyor. Değişirse `video_meta_log`'a yazılır. Rakiplerin A/B testleri ve değişiklikten önce/sonra büyüme hızı (eğim) görünür. NexLev'in "title/thumbnail change history" özelliği budur, burada kendi ölçümümüzle.

### 2.4 İçgörüler (Library → **Niş Takibi** sayfası ve MCP)
- **Bu hafta:** yeni videolar hız skoruna göre sıralı, thumbnail, başlık, süre ve yükleme saatiyle.
- **Nişin eğrisi:** "Bu nişte bir uzun video 30 günlük izlenmesinin %X'ini ilk 48 saatte alıyor." Shorts için ayrıca.
- **Ne işe yarıyor:** 48 saatlik hıza göre en iyi yükleme günü ve saati (kesin zaman damgasıyla). Ayrıca süre aralıkları, başlıktaki kelime ve kalıplar, Shorts ve uzun video karşılaştırması, yükleme sıklığı ile ortalama performansın ilişkisi.
- **Konu boşlukları:** hızı yüksek ama az video çıkan konular. Başlık kelimeleri ve etiketlerle kümelenir.
- **Kendi videom ve niş:** "Pivot videon 48. saatte 1,2 bin; senin büyüklüğündeki kanalların medyanı 0,8 bin (abone başına 0,4 ve 0,25)."
- **Haftalık özet:** bridge her pazartesi bir rapor hazırlar (Library'de görünür). İstenirse Claude ile yorumlanır.
- **MCP araçları:**
  - `niche_pulse` (nişin son N günü)
  - `video_velocity` (bir videonun eğrisi ve kanal/niş medyanı)
  - `breakouts` (hızlı yükselenler)
  - `channel_growth` (günlük abone ve izlenme)
  - `niche_report` (haftalık özet verisi; yorumu Claude yazar)

## 3. Kendi kanal verilerim: zaman içindeki ilerleme

### 3.1 Toplama (`mcp/youtube-analytics.mjs` genişler, bridge'de günlük iş)
- **İlk bağlantıda geçmiş doldurma:** kanalın açıldığı günden bugüne **günlük** satırlar (`dimensions=day`). Metrikler: izlenme, engaged views, izlenme süresi, ortalama izlenme yüzdesi, abone kazanımı ve kaybı, beğeni, yorum, paylaşım, thumbnail gösterimi ve tıklama oranı (CTR). Analytics API geçmişe dönük veri verdiği için ilerleme grafiği bugünden değil, ilk günden başlar.
- **Her gün (sabah 06:00):** son 7 gün yeniden çekilir. Analytics 2–3 gün geriden gelir ve sonradan düzeltir.
- **Video bazında günlük:** son 90 günde yüklenen her video için `dimensions=day&filters=video==ID`. Böylece "pivot videosunun ilk 30 günü" eğrisi Analytics'ten de gelir.
- **Kırılımlar (haftalık anlık değer):** trafik kaynakları (`insightTrafficSourceType`), **seni bulan arama terimleri** (`insightTrafficSourceDetail`, YT_SEARCH), ülkeler, yaş ve cinsiyet, cihazlar, abone olan / olmayan izleyici, oynatma yerleri.
- **Gelir (karar: şimdiden istenir):** `yt-analytics-monetary.readonly` izni bağlantı ekranına eklenir. Mevcut bağlantı yeni izin için bir kez yeniden onay ister. Veri, kanal YouTube Partner Programı'na girince dolmaya başlar: tahmini gelir, RPM, CPM, reklam türleri. O zamana kadar sayfa "YPP'ye girince burada görünecek" der.
- **Gerçek zamana yakın veri:** Analytics geride kaldığı için kendi videoların da tracker'a girer (2.2). Saatlik Data API ölçümü "son 48 saat" kartını besler.

**Tablolar:** `own_daily (channel_id, day, metric JSON)`, `own_video_daily (video_id, day, metric JSON)`, `own_breakdowns (channel_id, week, kind, data JSON)`.

### 3.2 Library → **Kanalım** sayfası (mevcut "My YouTube channel" genişler)
- **İlerleme grafikleri:** abone, izlenme, izlenme süresi, CTR, ortalama izlenme yüzdesi. Günlük, haftalık ve aylık görünüm; 7, 28, 90 ve 365 günlük karşılaştırma ("önceki 28 güne göre +%34").
- **YPP ilerlemesi:** 1.000 abone ve son 365 günde 4.000 saat izlenme, ya da 90 günde 10 milyon Shorts izlenmesi. İlerleme çubuğu ve "bu hızla ~X günde" tahmini.
- **Kilometre taşları:** 100, 500, 1.000 abone; ilk 10 bin izlenmeli video gibi. Bildirim isteğe bağlı.
- **Video karnesi:** her videonun ilk 48 saat, 7 gün ve 30 gün sonuçları, kanal medyanın ve niş medyanıyla yan yana.
- **Arama terimleri:** seni bulan kelimeler ve hafta hafta değişimleri. Bu kelimeler bir sonraki videonun başlığına girdi olur.
- **Kâr hesaplayıcı:** NexLev'deki muadili. Video başına maliyeti (ses, thumbnail, zaman) girersin, gelir verisi varsa net sonuç çıkar.
- **Birden fazla kanal (karar: iki kanal):** şu an tek token dosyası var (`youtube-token.json`). Kanal başına bir token (`youtube-token-<UC…>.json`) ve kanal seçici ile birleşik görünüm eklenir. Başlangıçta Hands on Excel ve kardeşinin Quran kanalı. Kardeşinin kanalı için onun Google hesabıyla bir kez "Kanal ekle" yapılır. NexLev'in "Combined channel analytics" muadili. Quran kanalı Excel nişinin takibine girmez; istenirse kendi nişiyle ayrı bir takip listesi olur.
- **MCP:** `my_channel_history` (günlük seri), `my_video_history`, `my_search_terms`, `my_ypp_progress`.

## 4. Özellikler sekmesi: hepsi aç/kapa

`src/features.js` her özelliği tek yerde tanımlar: `id`, TR/EN etiket, grup, varsayılan değer, gereksinim (`apiKey` | `bridge` | `oauth` | `none`) ve göründüğü yer. Panel'e bir **Özellikler** sekmesi eklenir (mevcut sekmeler: Reels / Analytics / Export). Library'de aynı liste **Ayarlar → Özellikler**'de de bulunur.

- Gereksinimi eksik bir özellik açılırsa yanında "API anahtarı gerekli → Ekle" gibi bir uyarı çıkar.
- Content script'ler bir özelliği mount etmeden önce `features.isOn(id)` diye sorar. Değişiklik sayfa yenilenmeden uygulanır (`chrome.storage.onChanged`).
- Bridge işleri (takip, uyarı, günlük Analytics) `meta.features` anahtarına bakar.

| Grup | Özellik (`id`) | NexLev muadili | Varsayılan | Gereksinim |
|---|---|---|---|---|
| **Video kartları** (arama, ana sayfa, yan liste, kanal) | `card-vph`: VPH rozeti | VPH | açık | yok |
| | `card-outlier`: outlier rozeti (medyan / ortalama) | Outlier score | açık | kayıtlı kanal ya da API anahtarı |
| | `card-subs`: kanal abone sayısı | Subscriber count | açık | API anahtarı (`channels.list`) |
| | `card-velocity`: takip edilen videoda "24s: 3,4×" | yok (bize özel) | açık | tracker |
| **Akışlar** | `feed-filters`: arama, ana sayfa ve abonelik filtreleri (outlier, VPH, süre, izlenme, tarih, abone/izlenme oranı) | Advanced filters | açık | yok |
| | `hide-shorts`: aramada Shorts'u gizle | Hide Shorts | kapalı | yok |
| | `channel-sort`: kanal videolarını outlier'a göre sırala | Sort by popularity | açık | yok |
| **Kanal sayfası** | `channel-stats`: yaş, toplam izlenme, video başına ortalama ve medyan, aylık yükleme, ortalama süre, Shorts var mı, ülke | Analytics sekmesi (ücretsiz kısmı) | açık | yok / API anahtarı |
| | `channel-growth`: günlük abone ve izlenme grafiği (takip başladıktan itibaren) | Views & subscribers graph | açık | tracker |
| | `channel-track`: Takip et butonu | Real-time channel tracker | açık | bridge + API anahtarı |
| | `channel-monetization`: Monetized rozeti | Monetized | açık | YouTube'a istek |
| | `channel-similar`: benzer kanallar (bölüm 6.4) | Similar channels | açık | yok |
| | `channel-sponsors`: sponsor ve affiliate taraması (bölüm 6.3) | Sponsorship analysis | açık | API anahtarı |
| | `channel-rpm`: tahmini RPM ve gelir aralığı (kategori tablosu × izlenme, "tahmin" etiketiyle) | Revenue / RPM | kapalı | yok |
| **Video sayfası** | `video-card`: outlier, VPH (ömür boyu ve son 24 saat), engagement, hız eğrisi | Video analysis | açık | yok / tracker |
| | `video-monetization` | Monetized $ | açık | YouTube'a istek |
| | `transcript-tools`: kopyala, dışa aktar (txt/srt/md), "Claude'a gönder" | Summarize / topics / export | açık | yok (özet için MCP) |
| | `comment-tools`: soru, kelime ve küfür filtreleri, yorumları dışa aktar, "Claude ile analiz" | Comment analyzer | açık | yok (analiz için MCP) |
| | `frame-capture`: o anki kareyi kopyala ya da indir | Screenshot | açık | yok |
| | `title-history`: başlık ve thumbnail geçmişi | Change history | açık | tracker |
| | `swipe-save`: videoyu klasöre kaydet, not, etiket, zaman aralığı (klip) | Swipe file | açık | yok |
| | `dislikes`: dislike sayısı (Return YouTube Dislike, returnyoutubedislike.com'a atıf linkiyle) | Dislike revealer | açık | üçüncü parti (video ID'si o servise gider) |
| **Shorts akışı** | `shorts-overlay`: VPH, yayın tarihi, kanal yaşı, kanalın ortalama Shorts izlenmesi | Shorts analytics | açık | yok / API anahtarı |
| **YouTube Studio** | `thumb-compress`: 2 MB'tan büyük thumbnail'i sıkıştır | Thumbnail compressor | açık | yok |
| | `thumb-preview`: thumbnail ve başlığı sahte bir YouTube ana sayfa ızgarasında rakiplerin yanında gör (Library'de de var) | Thumbnail & title tester | açık | yok |
| **Arka plan (bridge)** | `tracker`: niş takibi | Channel tracker | açık | bridge + API anahtarı |
| | `breakout-alerts`: hızlı yükselen bildirimi | yok | açık | tracker |
| | `weekly-digest`: haftalık niş raporu | yok | açık | tracker |
| | `niche-radar`: anahtar kelimelerle günlük arama (bölüm 6.5) | Viral videos from small channels | kapalı | API anahtarı (arama 100 birim) |
| | `own-history`: kendi kanal geçmişi | Studio analytics | açık | OAuth |
| | `own-revenue`: gelir ve RPM | Revenue | açık (veri YPP'den sonra gelir) | OAuth + monetary izni |
| | `api-retention-30d`: rakiplerin API verisini 30 günde sil (politikaya uyum) | yok | kapalı | yok |

**Bilerek yapmayacaklarımız:** NexLev'in Studio scraping'i (Analytics API ile gerek yok), otomatik reklam yerleştirici (mid-roll ad placer, düşük değer), AI thumbnail üretici (Higgsfield zaten var), CMS ağları.

## 5. Mevcut özelliklerle birleşme
- Kayıtlı kanallar için outlier ve medyan zaten hesaplanıyor (`metrics.js`). Kart rozetleri aynı fonksiyonu kullanır.
- Kayıtlı olmayan kanallarda rozetin ortalama sürümü `channels.list` ile hesaplanır (`viewCount ÷ videoCount`, 50 kanal = 1 birim). Sonuç 7 gün önbellekte tutulur. Medyan sürümü sadece kayıtlı kanallarda gösterilir; rozet "≈ ort." diye hangisi olduğunu belirtir.
- Eklenti YouTube'un kendi yanıtlarını okumaya devam eder (`hook.js`). Sayfada görülen her kesin sayı `video_stats`'a da `source=page` olarak yazılır, bedava ek ölçüm olur.
- Yorumlar: watch sayfasındaki `/next` yanıtları zaten yakalanıyor. Yorum araçları önce bunları, gerekirse `commentThreads.list`'i (100 yorum = 1 birim) kullanır.

## 6. Sunucu isteyen kısımları kendi ölçeğimizde yapmak

Bu bölüm bedava ya da çok ucuz yöntemleri anlatır. Üçüncü parti API'ler bölüm 8'de.

### 6.1 Monetization
NexLev'in birebir yöntemi: watch sayfasındaki `yt_ad`. Kanal kontrolünde 5 video örneklenir: baş, %25, %50, %75, son. Sonuç 7 gün önbellekte tutulur, istekler sırayla atılır, en fazla dakikada 10. Kapalı başlar.

### 6.2 Yüz göstermeyen (faceless) kanal kontrolü
MCP aracı `channel_faces`, kanalın 6 thumbnail'ini ve 2 video karesini Claude'a verir; Claude karar verir. Bridge'de bir model yok, maliyet yok, kanal başına bir kez çalışır.

### 6.3 Sponsor ve affiliate taraması
Takip edilen kanalların açıklamaları `videos.list snippet` ile zaten geliyor. Kurallarla taranır: "sponsored by", "use code", "%… indirim", bit.ly / amzn.to / utm parametreleri, bilinen affiliate alan adları. Çıktı "Bu nişte kim neyi tanıtıyor, hangi sıklıkla" listesi olur. Kendi nişimizde NexLev'in sponsor veritabanının küçük ve kendi verimizle yapılmış bir sürümü.

### 6.4 Benzer kanallar (bedava yöntem)
- **Öneri grafiği:** eklenti, izlediğin niş videolarının "Up Next" listelerini zaten görüyor (`/next`). Hangi kanalların hangi kanallarla birlikte önerildiğini sayar. Birlikte görülme sayısı arttıkça kanallar "benzer" olur.
- **Kütüphane içi benzerlik:** başlık ve etiket kelime kümeleri (TF-IDF) ve thumbnail için perceptual hash. "Benzer thumbnail'ler" de buradan gelir.
- Takip edilen bir kanalın en iyi 5 videosunun öneri listesi haftada bir arka plan sekmesinde açılabilir (`refresh_reel`'in yöntemiyle, isteğe bağlı).

### 6.5 Niş radarı (küçük kanallarda patlayan videolar)
- Anahtar kelime listesi, örneğin "excel pivot", "xlookup", "excel dashboard".
- Günde bir `search.list` (100 birim) ile `publishedAfter` = son 7 gün, `order=viewCount`. 20 kelime günde 2.000 birim eder.
- Sonuç videoları için `videos.list` ve kanallar için `channels.list`, ardından abone başına izlenme ve VPH hesaplanır.
- Çıktı: "Bu hafta küçük kanallarda patlayanlar" ve "henüz takip etmediğin yükselen kanallar" (tek tıkla takibe al).

### 6.6 Anahtar kelime fikirleri
- YouTube'un otomatik tamamlama önerileri ve "people also search" türü kelimeler, kendi arama terimlerin (3.1) ve nişteki başlık kelimeleriyle birleştirilir.
- Arama hacmi için bölüm 8'deki seçeneklere bakılır.

## 7. Aşamalar

| Faz | İçerik | Tahmini süre |
|---|---|---|
| **0. Altyapı** | `src/features.js` ve **Özellikler** sekmesi (panel ve Library). Bridge'de iş zamanlayıcı (`mcp/tracker.mjs`, yeniden başlatmaya dayanıklı, `tracker_jobs`). Bridge için API anahtarı. DB migration'ları. Kota sayacının bridge'e taşınması. Test: `tests/tracker.test.mjs` ile sahte saat ve sahte API. | 2–3 gün |
| **1. Niş takibi** | Takip listesi ve Takip et butonu. RSS ile yeni video tespiti. Ölçüm takvimi. Kontrol noktaları, kanal ve niş eğrileri, hız skoru. Erken uyarı bildirimi. Library'de **Niş Takibi** sayfası. MCP: `niche_pulse`, `video_velocity`, `breakouts`, `channel_growth`. | 4–5 gün |
| **2. Kendi kanal geçmişi** | Analytics geçmiş doldurma ve günlük iş. Kırılımlar. **Kanalım** sayfası: grafikler, YPP ilerlemesi, video karnesi, arama terimleri. Çoklu kanal. İsteğe bağlı gelir izni. MCP: `my_channel_history` ve diğerleri. | 3–4 gün |
| **3. Sayfa içi rozetler ve kartlar** | `card-*`, `feed-filters`, `hide-shorts`, `channel-sort`, `channel-stats`, `video-card`, `shorts-overlay`, monetization. | 3–4 gün |
| **4. İçerik araçları** | Transcript ve yorum araçları (Claude'a gönderme dahil), kare yakalama, swipe file, başlık ve thumbnail geçmişi, sponsor taraması, thumbnail sıkıştırma ve thumbnail tester. | 3–4 gün |
| **5. Keşif** | Niş radarı, benzer kanallar (öneri grafiği ve kütüphane içi), anahtar kelime fikirleri. Seçilen üçüncü parti API'lerin isteğe bağlı entegrasyonu (bölüm 8), her biri kendi aç/kapa ayarıyla. | 3–5 gün |
| **6. NexLev'i kaldırma** | Bölüm 9'daki kontrol listesi. | 0,5 gün |

Her fazın sonunda: `npm test`, dev demo sayfalarında (`dev/youtube-demo.html`) yeni durumlar, README ve bu dosyanın "Notlar" bölümünün güncellenmesi.

**Neden bu sıra:** Faz 1 ve 2 en önemli istekler, ve veri biriktirmeleri zaman alıyor. Takip ne kadar erken başlarsa eğriler o kadar erken anlam kazanır. Sayfa içi rozetler (Faz 3) bu verinin üstüne oturur.

## 8. Üçüncü parti API'ler

Fiyatlar 2026-11-21'de resmi sayfalardan okundu. "Doğrulanamadı" yazanlar resmi sayfada teyit edilemedi.

**Önce bilinmesi gereken üç şey:**
- **Scraping API'leri YouTube'un politikasıyla çelişiyor.** SerpApi, ScrapeCreators, Apify ve DataForSEO'nun YouTube sonuçları YouTube'u kazıyarak (scraping) elde ediliyor. Bunları API anahtarımızla aynı uygulamada kullanmak YouTube politikası §III.E.6'ya teknik olarak aykırı. Bu yüzden her biri **ayrı, kapalı başlayan** bir ayar olur ve verisi ayrı etiketlenir.
- **Keywords Everywhere ve Ahrefs'in API'leri YouTube arama hacmi vermiyor.** Keywords Everywhere'de YouTube hacmi sadece tarayıcı eklentisinde var. Ahrefs API'sinde YouTube motoru parametresi yok.
- **Başka kanalların kitle demografisi** (yaş, cinsiyet, ülke) satan API'lerin hepsi kurumsal fiyatlı: Modash yılda $10.000+, HypeAuditor ayda $200+. Bu özellik yapılmayacak.

### 8.1 Eksiklere göre seçenekler

| Eksik | En uygun seçenek | Bedava kısmı | Ücretli | Not |
|---|---|---|---|---|
| **Rakiplerin geçmiş abone ve izlenme grafiği** (takip başlamadan öncesi) | **Social Blade Business API** | yok (sadece test) | Kredi önceden ödenir: 100 kredi $50. Bir kanal 1 kredi (30 gün), 2 kredi (1 yıl) ya da 3 kredi (3 yıl günlük veri). Aynı kanal 30 gün boyunca tekrar bedava sorgulanır. | **Bir kerelik.** 3 yıllık geçmişle $50 ≈ 33 kanal, 1 yıllıkla 50 kanal. 200 kanalın hepsi için 3 yıl ≈ $300. Kredilerin süresi dolar mı: doğrulanamadı. |
| **Benzer kanal ve niş keşfi** | **NexLev Free MCP** (eklenti olmadan, sadece hesap) | Haftada en fazla **50 çağrı**. Günlük: kanal arama 5+5, benzer kanal 1, niş özeti 1, monetization 5, RPM 5, faceless 5, kanal outlier'ları 5 | Lite ₺189/ay | Eklentiyi kaldırıp MCP'yi Claude'a bağlamak, NexLev'in veritabanına bedava erişimi korur. MCP sadece soru sorar; tarayıcı gezintilerin ve Studio verin gitmez. Arama filtreleri belgelenmemiş. |
| | OutlierKit API ve MCP | 30 deneme kredisi, kart gerekmez | Hobby $49/ay (100 kredi, çoğu çağrı 2 kredi) | Gerçek bir API'si olan en ucuz ücretli seçenek. |
| | vidIQ MCP | Ayda 150 AI kredisi (~30 çağrı) | Boost $199/yıl | Benzer kanal, outlier, rakip istatistikleri. |
| **YouTube arama hacmi** | **vidIQ Free MCP** | ~30 çağrı/ay | — | Bedava olan tek gerçek YouTube hacmi. Ayda ~30 anahtar kelimeye yeter. |
| | OutlierKit | (yukarıda) | $49/ay | |
| | YouTube otomatik tamamlama (`suggestqueries…&ds=yt`) | sınırsız, resmi değil | — | Hacim vermez, fikir verir. 2026-11-21'de çalıştı. `hl=en&gl=US` gerekli, yoksa IP'ye göre Türkçe döner. |
| | Google Trends `gprop=youtube` | bedava, resmi değil | — | Göreli ilgi verir, hacim değil. pytrends Nisan 2025'te arşivlendi. Resmi Trends API alfa aşamasında ve başvuruyla. |
| **YouTube sıralama takibi** (bir kelimede kaçıncıyız) | DataForSEO YouTube SERP | $1 deneme | $50 yatırılır, süresi dolmaz. Arama başına ~$0,0006. | Günde 50 kelime ≈ **$0,90/ay**. Scraping kaynaklı (politika notu yukarıda). |
| **Kota dışı arama, yorum, transcript** | SearchApi.io | 100 istek, kart gerekmez | $40 / 10 bin istek | |
| | ScrapeCreators | 100 kredi + 1.200'e kadar bonus, kart gerekmez | $47 / 25 bin kredi, süresi dolmaz | |
| | Supadata (transcript) | 100 kredi/ay | $5/ay | yt-dlp zaten var; gerek yok. |
| **Dislike sayısı** | Return YouTube Dislike | bedava. İstemci başına dakikada 100, günde 10.000 istek | — | 2026-11-21'de çalıştı. returnyoutubedislike.com'a link vererek atıf zorunlu. Değerler tahmin (eklenti kullanıcılarından) ve 2–3 gün önbellekli. |
| **Data API kota artışı** | Google'ın başvuru formu | ücretsiz | — | Kişisel araç için onay olası değil, ama gerek de yok: plan günde ~130 birim (+ niş radarı ~2.000) harcıyor. |

### 8.2 Önerilen kurulum

| Katman | Ne | Maliyet |
|---|---|---|
| **Temel (her zaman)** | Data API (kendi anahtarın) + RSS + YouTube Analytics API (kendi kanalın) + otomatik tamamlama + yt-dlp | **$0** |
| **Bedava keşif (seçilen)** | NexLev Free MCP (haftada 50 çağrı) + vidIQ Free MCP (ayda ~30 çağrı), ikisi de Claude'a bağlı. Plan, Claude'un bunları **niş raporu** sırasında az ve öz kullanmasını tarif eder: benzer kanal ve niş özeti NexLev'den, anahtar kelime hacmi vidIQ'dan. | **$0** |
| **İsteğe bağlı, bir kerelik** | Social Blade: en önemli ~33 rakibin 3 yıllık günlük geçmişi | **$50** (hepsi için $300'e kadar) |
| **İsteğe bağlı, aylık** | DataForSEO sıralama takibi | **~$1/ay** ($50 yatırılır, süresi dolmaz) |
| **Ölçek büyürse** | OutlierKit Hobby (gerçek API, arama hacmi ve benzer kanallar) | $49/ay |

**Kodda nasıl yer alır:** her üçüncü parti servis `mcp/providers/<ad>.mjs` olarak ayrı bir dosyada durur ve Özellikler sekmesinde kendi anahtarı ve aç/kapa ayarı olur (`provider-socialblade`, `provider-dataforseo`, `provider-ryd` …). Hepsi varsayılan olarak kapalıdır. Anahtarlar `~/.openoutlier/providers.json` dosyasında, yalnız kullanıcı okuyabilir şekilde tutulur ve yedeklere girmez. NexLev ve vidIQ MCP'leri kodda değil, Claude'un bağlayıcıları olarak kullanılır; plan sadece hangi soruda hangisinin çağrılacağını tarif eder.

## 9. NexLev'i kaldırma kontrol listesi
Karar: **hesap ücretsiz MCP için tutulur**, eklenti ve abonelik gider.
1. Faz 1–3 bittikten sonra bir hafta yan yana kullan; eksik kalan bir şey varsa listeye ekle.
2. `chrome://extensions` → NexLev → Kaldır.
3. Aboneliği iptal et (ücretsiz plana düş).
4. Claude'a NexLev MCP'sini bağla (`prod.dashboard.nexlev.io/api/claude-mcp`, OAuth). vidIQ'nun ücretsiz MCP'sini de bağla. İkisinin Free sınırları: NexLev haftada 50 çağrı, vidIQ ayda ~30 çağrı.
5. Google hesabı → Güvenlik → Üçüncü taraf erişimi: NexLev'in YouTube erişimi varsa (kendi kanal analitiği için verilmişse) kaldır. Kendi kanal verimiz artık bizim Analytics bağlantımızdan geliyor.

## 10. Verilen kararlar (2026-11-21)

| Konu | Karar |
|---|---|
| Başlangıç kanalları | Kütüphanedeki ~15 Excel kanalı + Hands on Excel (bölüm 2.1) |
| Bütçe | **$0** ile başla. Social Blade ve DataForSEO sonra tekrar değerlendirilir. |
| API politikası (30 gün) | **Her şey saklanır.** `api-retention-30d` ayarı kapalı olarak durur. |
| Monetization kontrolü | **Açık başlar**, yavaşlatılmış istek ve 7 gün önbellek |
| Return YouTube Dislike | Eklenir, **açık başlar**, atıf linkiyle |
| Gelir izni | **Şimdiden istenir** (mevcut bağlantı bir kez yeniden onaylanır) |
| Çoklu kanal | **Hands on Excel + kardeşinin Quran kanalı** |
| NexLev hesabı | Ücretsiz MCP için tutulur; eklenti ve abonelik kaldırılır |
