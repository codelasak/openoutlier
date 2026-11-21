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

## Faz 0 notları

*2026-11-21, dal `claude/faz0-altyapi-632365`.*

### Yapılanlar

- **Özellik kaydı (`src/features.js`).** Bölüm 4'teki 32 özelliğin hepsi tek yerde: `id`, TR/EN etiket ve açıklama, grup, varsayılan, `requires` (hepsi gerekli), `optional` (olmadan da çalışır), `notes` (üçüncü parti, YouTube'a istek, MCP, tahmin), `surface`, `phase` ve `available`. Varsayılanlar bölüm 10'a göre: monetization açık, dislike açık, `own-revenue` açık, `api-retention-30d` kapalı; `hide-shorts`, `channel-rpm` ve `niche-radar` kapalı. Seçimler `rs:settings.features` içinde, **sadece kullanıcının değiştirdikleri** tutulur; bilinmeyen anahtar ya da boolean olmayan değer atılır, eksik olan varsayılana düşer. Tarayıcıda `isOn(id)`, `flags()`, `set(id, on)`, `reset()`, `onChange(cb)` (chrome.storage.onChanged), `env()` (API anahtarı, bridge, bridge'deki anahtar, OAuth). Aynı dosya Node'da da `require` edilir (bridge ve testler).
- **Özellikler sekmesi.** YouTube panelinde Videos / Analytics / Export'un yanında **Özellikler / Features**. Library'de yeni **Ayarlar / Settings** sayfası (`#/settings`, kenar çubuğunda dişli simgesi): aynı liste (`src/features-view.js`, iki yer aynı kodu kullanır), yanında **YouTube Data API anahtarı** (kaydet / sil / bridge'e kopyala, günün kota sayısı), **Bu Mac'teki bridge** (durum, kurulum komutu) ve **Dil** (Otomatik / Türkçe / English) kartları. Her satırda anahtar, kısa açıklama; açık ve gereksinimi eksik özelliklerde sarı uyarı ve düzeltme linki ("Anahtar ekle", "Anahtarı bridge'e kopyala", "Nasıl kurulur", "Bağla", "Aç"). Henüz yapılmamış özellikler soluk "Yakında" etiketiyle listelenir; sonraki fazlar sadece `available: true` yapar. Değişiklik sayfa yenilenmeden bütün açık sekmelere yansır.
- **Popup.** API anahtarı bölümüne **Copy key to bridge / Copy again / Remove from bridge** ve bridge'in anahtar durumu; kota satırı tarayıcı + bridge toplamını gösterir. Yeni **YouTube features** butonu Library → Settings'i açar.
- **Bridge.** `POST /settings`: eklenti bayrakları ve kendi günlük kota sayısını yollar (30 sn'lik tick'te değişince, en geç 5 dakikada bir, ayar ya da kota değişince hemen). Bridge bayrakları `meta.features` içinde (temizlenmiş, sadece değişenler) tutar; cevapta çözülmüş bayraklar, anahtarın olup olmadığı ve kaynağı (`env` | `file`), OAuth durumu ve kendi kota sayısı var (eklenti bunu `rs:bridge`'e yazar). `POST /settings/youtube-api-key`: anahtarı `~/.openoutlier/youtube-api-key` dosyasına 600 izinle, atomik yazar ya da siler; anahtar hiçbir cevapta geri dönmez. `/health` özellik listesine `settings` ve `tracker` eklendi. `OPENOUTLIER_YOUTUBE_API_KEY` dosyadan önce gelir.
- **Kota.** Tek sayı: bridge kendi birimlerini `meta.youtube_api_quota`, eklentininkini `meta.youtube_api_quota_ext` içinde tutar; `bridge_status`, popup, panel ve Library toplamı gösterir (`used_today`, `bridge`, `extension`).
- **Zamanlayıcı (`mcp/tracker.mjs`).** İşler `tracker_jobs` tablosunda; yeniden başlatmada kaldığı yerden devam eder (kaçırılan çalışmalar bir kez çalışır, tekrar tekrar değil). Her iş türü `{ feature, every, jitter, units, run }`; sadece özelliği açıkken (ve API işleri için anahtar varken) çalışır. Jitter, süreç içi tek uçuş (single flight), süreçler arası kira (`meta.tracker_lease`; launchd daemon'u ve bir MCP sunucusu aynı anda iş çalıştırmaz), çalıştırmadan önce sahiplenme (iş süreci çökertirse döngüye girmez), hatada 2-4-8… dk geri çekilme (en çok 6 saat), günlük kota bütçesi (varsayılan 9.000 birim, eklentinin harcadığı dahil; aşılınca iş Pasifik gününün başına ertelenir). İki iş türü var: `heartbeat` (15 dk, işlevsiz, `tracker` açıkken) ve `api-retention` (günde bir, `api-retention-30d` açıkken). Daemon ve bridge'i tutan MCP sunucusu başlatır; `bridge_status` → `tracker` iş sayılarını, son tick'i ve son heartbeat'i gösterir.
- **Migration'lar (`mcp/store.mjs`).** Sürümlü (`meta.schema_version`, şu an 1), her adım kendi transaction'ında, tablolar `IF NOT EXISTS`: `tracked_channels`, `video_stats` (`source`), `video_meta_log`, `channel_stats`, `tracker_jobs`, `own_daily`, `own_video_daily`, `own_breakdowns`. Mevcut veri korunur (eski şemalı bir veritabanıyla test edildi). Yardımcılar: `addColumn`, `addVideoStats`, `videoStats`, `purgeApiData`.
- **Testler.** `tests/features.test.js` (kayıt, varsayılanlar, temizleme, gereksinimler, dil, sahte chrome.storage ile isOn/set/onChange/env), `tests/migrations.test.mjs` (eski veritabanı, tekrar çalıştırma, `video_stats`, 30 gün silme), `tests/tracker.test.mjs` (sahte saat ve sahte API: takvim ve jitter, özellik kapalıyken bekleme, tek uçuş, kira, yeniden başlatma, çökme ve geri çekilme, kota bütçesi ve Pasifik günü, retention, start/stop), `tests/mcp.test.mjs`'e uçtan uca `/settings` + anahtar dosyası + `bridge_status`. `npm test`: **220/220 geçti.**
- **Ekran görüntüleri** (`docs/screenshots/`): `phase0-panel-features-en-dark.png`, `phase0-panel-features-tr-light.png`, `phase0-panel-features-background-en-light.png`, `phase0-panel-features-narrow-tr-dark.png`, `phase0-library-settings-en-light.png`, `phase0-library-settings-tr-dark.png`, `phase0-library-settings-medium-tr-light.png`, `phase0-library-settings-narrow-en-dark.png`, `phase0-popup-bridge-key-dark.png`, `phase0-popup-bridge-key-light.png`.

### Plandan sapmalar

- **`tracker_jobs` genel bir iş tablosu.** Planda `video_id` birincil anahtardı; heartbeat, retention ve ileride kanal işleri de aynı tabloda durduğu için birincil anahtar `id` (`heartbeat`, `video:<id>`, `channel:<UC…>`), yanında `kind`, planın sütunları (`video_id`, `channel_id`, `published_at`, `next_at`, `tier`) ve iş defteri sütunları (`last_run_at`, `last_ok`, `last_error`, `runs`, `fails`, `data`).
- **`channel_stats.source`** eklendi (varsayılan `api`), 30 gün silme ayarı kanal istatistiklerini de kapsayabilsin diye. `own_*` tablolarına `updated_at` eklendi.
- **Kota sayacı taşınmadı, birleştirildi.** Eklenti ve bridge kendi sayaçlarını tutmaya devam ediyor, birbirlerine bildiriyorlar; ikisi de toplamı gösteriyor. Aynı anahtar aynı Google Cloud projesinin kotasını harcadığı için toplam doğru sayı. (İki farklı anahtar kullanılırsa toplam fazla görünür; zararsız.)
- **Gereksinimler biraz daha ince.** `apiKey` (tarayıcıdaki anahtar) ile `bridgeKey` (bridge'deki kopya) ayrı; arka plan işleri (`tracker`, `channel-track`, `niche-radar`) `bridge + bridgeKey` ister. `tracker` gerektiren özellikler takibin eksiklerini miras alır ya da "niş takibi kapalı → Aç" der. Bridge bağlı değilken bridge'deki anahtar ve OAuth "bilinmiyor" sayılır, ayrıca uyarı çıkmaz.
- **"Yakında" özellikler de açılıp kapatılabiliyor.** Böylece kullanıcı bir özelliğin açık mı başlayacağını şimdiden seçebilir ve faz 0'da açma/kapama uçtan uca denenebiliyor.
- **Dil.** Projede bir i18n düzeni yoktu (arayüz İngilizce). TR/EN sadece Özellikler listesinde ve Library → Ayarlar sayfasında var; panelin diğer sekmeleri, popup ve Library'nin geri kalanı İngilizce kaldı. Dil sırası: kayıtlı seçim (`rs:settings.uiLang`) → `?hl=` → YouTube sayfasının `<html lang>` (içerik sayfalarında) → Chrome'un dili.
- **Özellikler sekmesi sadece YouTube panelinde.** Instagram, TikTok ve Reddit panellerinde yok (listede o platformlara ait özellik yok).
- **Outlier formülü seçimi (medyan / ortalama)** bir aç/kapa değil, seçim; faz 3'e bırakıldı.
- **2.2'deki "RSS gecikmesi faz 0'da doğrulanacak" yapılmadı.** Bir gün boyunca gerçek RSS ve API ölçümü gerekiyor; bu oturumda ağ üzerinden uzun süreli ölçüm yapılmadı. Faz 1'in ilk işi olmalı (aşağıda).

### Faz 1 için bilinmesi gerekenler

- **Yeni iş türü eklemek:** `mcp/tracker.mjs` → `KINDS`. `every` sayı (ms) ya da `(job, now) => ms` olabilir (yaş katmanları için). `run(ctx, job)` içinde `ctx.fetch`, `ctx.apiKey`, `ctx.quota.spend(n)` / `canSpend(n)`, `ctx.store`, `ctx.now`, `ctx.flags`; dönüş `{ next_at?, tier?, data? }`. `units > 0` olan türler anahtar yoksa hiç çalışmaz ve bütçe bitince ertelenir. Video işleri: `tracker.schedule('video:' + id, { kind: 'video', video_id, channel_id, published_at, tier })`. `schedule` sadece veritabanına yazar; iş sahibi olmayan bir süreç (ör. bridge'i tutmayan MCP sunucusu) de satır ekleyebilir, işi kirayı tutan süreç çalıştırır.
- **RSS ve API ölçümleri:** `store.addVideoStats([{ video_id, ts, views, likes, comments, source: 'rss' | 'api' | 'page' }])`. Aynı video ve aynı ms'de ikinci satır yok sayılır.
- **İlk iş: RSS gecikme ölçümü.** Birkaç yeni videoda bir gün boyunca saatte bir RSS ve `videos.list` yan yana `video_stats`'a yazılıp karşılaştırılmalı (2.2).
- **Özellik bayrakları:** içerik script'leri `self.OpenOutlierFeatures.isOn(id)` diye sorar (önce `await FT.ready`), `FT.onChange` ile kapanınca kendini söker. Bridge tarafında `featureFlags(store)` (tracker.mjs). Bir özellik çıkınca `src/features.js`'de `available: true` yapılır; testteki "sadece api-retention-30d hazır" beklentisi de güncellenmeli.
- **Anahtar:** bridge'de `apiKey()` / `apiKeyInfo()` (`mcp/youtube-api.mjs`); birim harcamak için `spendOn(store, n)`.
- **Takip listesi:** `tracked_channels` boş. Faz 1, Library'de "Takip edilen niş" olarak işaretlenen klasör/etiketten ve "Takip et" butonundan doldurur; `mine = 1` satırları 30 gün silmesinden muaf.
- **Kurulum notu:** güncellemeden sonra çalışan bridge eski kodla kalır; `launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge` gerekir. Eski bridge'de "Copy key to bridge" bunu söyler, Özellikler sekmesi bridge anahtarını "bilinmiyor" gösterir.
- **Geliştirme:** worktree'de `mcp/node_modules` yoksa `npm test`'ten önce `cd mcp && npm ci`. Demo sayfaları: `?bridge=off|nokey|ready`, `?ytapi`, `?hl=tr`.

### Açık konular

- Bölüm 6.1 "Kapalı başlar" diyor, bölüm 4 ve 10 "açık". Karar (bölüm 10) uygulandı: `channel-monetization` ve `video-monetization` açık.
- Panel ve Library'nin Özellikler dışındaki kısımları İngilizce; tam TR çevirisi ayrı bir iş.
- Gerçek Chrome'da (yüklü eklenti, gerçek bridge) uçtan uca deneme yapılmadı; doğrulama demo sayfaları, Playwright ve Node testleriyle yapıldı.

## Faz 1 notları

*2026-11-21, dal `claude/faz1-nis-takibi-7fc52f` (`youtube-niche` üstüne).*

### Yapılanlar

- **Takip listesi (`src/tracking.js`).** Liste Library'nin klasör kaydında (`rs:org`) duruyor, böylece bridge'e mevcut senkronla gidiyor: `org.niches = { folders, tags }` (takip edilen niş olarak işaretlenen klasör/etiketler) ve `org.tracked = { 'yt/handle': { on, mine, channelId, name, at } }` (Takip et butonu; `on: false` nişteki bir kanalı dışarıda bırakır). Bridge her `/sync`'te `syncTracked` ile `tracked_channels`'ı ve işleri günceller: yeni kanal → hemen `rss:` işi ve bir kerelik `backfill:` işi; listeden çıkan kanal → `active = 0`, işleri silinir, ölçümleri kalır; UC kimliği bilinmeyen `yt/handle` → `resolve:` işi (`channels.list forHandle`, 1 birim). `mine` olan kanal bir klasör/etikette değilse en büyük nişe katılır (karşılaştırma için).
- **Takip et butonu.** YouTube kanal sayfasında Abone ol'un yanında (kendi shadow DOM'u, YouTube'un açık/koyu temasına uyar), YouTube panelinin araç çubuğunda, Library'de kanal sayfasında (+ "Benim kanalım" kutusu) ve klasör/etiket başlığında "Niş olarak takip et". Hepsi `channel-track` özelliğine bağlı; TR/EN.
- **Tek tıklık başlangıç.** Niş Takibi sayfası boşken kayıtlı YouTube kanallarını listeler; Excel listesindeki 15 isim (isim/handle eşleşmesi) ve Hands on Excel (`mine`) seçili gelir; "N kanalı takip et" hepsini "Excel" klasörüne koyar (varsa onu kullanır), klasörü niş yapar, Hands on Excel'i `mine` işaretler (kayıtlı değilse handle'ıyla, sonra `resolve`). Library'de olmayan isimler ayrıca listelenir.
- **İşler (`mcp/niche.mjs` → `tracker.mjs` KINDS).**
  - `rss` (kanal başına 15 dk, kota yok): iki akış (`mcp/rss.mjs`), izlenme + beğeni `source='rss'`, yeni videolar `tracked_videos`'a girer ve API işi hemen planlanır; başlık her okumada, thumbnail (genç videolarda 6 saatte, eskilerde günde bir, iş başına en çok 4) perceptual hash ile karşılaştırılır (`mcp/thumbhash.mjs`: ffmpeg ya da macOS `sips` ile 9×8 gri → dHash; ikisi de yoksa SHA-1). Değişiklikler `video_meta_log`'a.
  - `video` (toplu): tracker'a **batch iş türü** eklendi (`batchSize`, `runBatch`); vadesi gelen video işleri 50'şer `videos.list` çağrısıyla (1 birim) ölçülür. Takvim `V.nextMeasure`: 0–6 sa 30 dk (`fastStart`, ayardan), 6–48 sa 1 sa, 2–7 g 6 sa, 7–30 g 1 g, sonra 7 g; bir kontrol noktasını uyuyarak geçmez (noktadan 5 dk sonra uyanır), böylece her nokta iki ölçümle çevrelenir. Silinen/gizli video 3 denemeden sonra bırakılır.
  - `channel-stats` (günde bir, 50 kanal = 1 birim) → `channel_stats`.
  - `backfill` (kanal başına bir kez): "All uploads via API" yolu (`A.channelUploads`, en yeni 500); kayıtlar Library'ye `mergePost` ile yazılır, `tracked_videos` + bir API ölçümü + haftalık iş (hafta içine dağıtılarak).
  - `digest` (pazartesi 07:00 yerel, `weekly-digest`): geçen haftanın raporu `niche_reports`'a.
  - Ölçümden sonra **hızlı yükselen kontrolü** (`breakout-alerts`): video, 6. veya 24. saatte kendi nişinin modeline göre beklenenin ≥ eşik katıysa `niche_alerts`'a (aynı video + nokta bir kez).
- **Sayfa ölçümleri.** `Store.applySync`, takip edilen kanalların videolarında eklentinin gördüğü **kesin** sayıları (yuvarlak değil, sayı değişmişse) `video_stats`'a `source='page'` olarak, sayfanın gördüğü zamanla (`seenAt`) yazar.
- **Metrikler (`src/velocity.js`, saf fonksiyonlar, `tests/velocity.test.js`).** Kontrol noktaları (1/3/6/12/24/48/72 sa, 7/14/30 g) doğrusal ara değerle; yayın anı 0 izlenme sayılır; bir nokta ancak iki yandaki ölçümler yakınsa (aralık ≤ max(2 sa, nokta×0,5)) ya da bir ölçüm noktanın %5'i içindeyse bilinir. Kanal eğrisi (format başına medyan), kanalın tipik izlenmesi (≥ 3 günlük videoların medyanı, Library'deki outlier mantığı), niş eğrisi (izlenme ÷ kendi kanalının tipik izlenmesi, medyan), beklenen eğri (kanal noktada ≥ 5 videoya ulaşana kadar niş × tipik izlenme), hız skoru (geçilen son kontrol noktasında izlenme ÷ beklenen), 48 saatte abone başına izlenme, evergreen oranı (30 g ÷ 48 sa; ≥ 3 evergreen, ≤ 1,3 patlama), son 24 saatin VPH'si, ömür boyu VPH, değişiklik öncesi/sonrası eğim, "ne işe yarıyor" (gün × 3 saatlik blok, süre aralıkları, başlık kelimeleri ve kalıpları, Shorts/uzun), konu boşlukları, RSS gecikmesi.
- **RSS gecikme ölçümü (faz 0'ın açık maddesi).** `V.rssLag`: her RSS okuması için API serisinin o sayıya kaç dakika önce ulaştığı (aynı videonun iki API ölçümü arasında ara değer) + 10 dk içindeki okumalarda yüzde fark; 48 saatten genç videolar ayrıca. Karar: `collecting` (< 12 örnek), `rss-ok` (medyan ≤ 60 dk), `rss-lags`. `bridge_status` → `niche_tracking.rss_lag` (`how_to_read` ile) ve Niş Takibi → Takip edilen kanallar → "RSS ve Data API". Simülasyonla (RSS 25 dk geride) test edildi; gerçek değer ilk gün dolunca görünür.
- **Library → Niş Takibi (`dashboard/niche-view.js`, `#/niche`, TR/EN).** Bridge'den tek cevap (`GET /youtube/niche/page`, servis worker üzerinden `reelscope:niche`). KPI şeridi; bu haftanın yüklemeleri (skora göre, thumbnail, başlık, kanal, yükleme zamanı, kıvılcım grafiği + beklenen eğri, skor rozeti: ≥ 2× lime/ink, ≥ 3× piksel gölgeli; ilk 12, "hepsini göster"); niş eğrisi (30 günün payı, uzun düz / Shorts kesik çizgi, doğrudan etiket; 30 güne ulaşan video azsa "kanalın tipik videosunun katı"); ne işe yarıyor (ısı haritası, süre ve format çubukları, kelime çipleri, kalıp tablosu, haftalık yükleme); konu boşlukları; başlık/thumbnail değişiklikleri (önce/sonra saat başına izlenme); hızlı yükselenler; benim videolarım ve niş (benzer büyüklükteki kanallar ⅓×–3× ya da bütün niş; 48 saat dolmadıysa bugünkü sayılar ve karşılaştırmanın geleceği zaman); kanal büyümesi; haftalık özet (kayıtlı ya da bu haftanın gidişatı); takip edilen kanallar, RSS gecikmesi, uyarı eşiği (2–5×) ve "ilk 6 saatte 30 dk" ayarı (`rs:settings.niche` → bridge `meta.niche_settings`). Boş durumlar ne zaman dolacağını söyler. Kenar çubuğunda "Niş Takibi" (görülmemiş hızlı yükselen sayısıyla rozet).
- **Bildirim.** Bridge'in `/settings` cevabı gösterilmemiş uyarıları taşır; servis worker `breakout-alerts` açıksa Chrome bildirimi gösterir (tıklayınca `#/niche`), listeyi `rs:niche-alerts`'e yazar ve `/youtube/niche/alerts/ack` ile işaretler (kapalıysa da işaretler: "sonra söyle" değil "söyleme").
- **MCP.** `niche_pulse`, `video_velocity`, `breakouts`, `channel_growth`, `niche_report` (`mcp/niche-tools.mjs`), `bridge_status` → `niche_tracking`. README tablosunda.
- **Özellikler.** `available: true`: `tracker`, `channel-track`, `breakout-alerts`, `weekly-digest`, `channel-growth`, `title-history` (son ikisinin Library tarafı; `title-history` fazı 1 yapıldı).
- **Migration 2 (`store.mjs`).** `tracked_videos` (başlık, yayın zamanı, format, thumbnail ve hash'i, süre, etiketler), `niche_alerts`, `niche_reports`; `tracked_channels`'a `name`, `handle`, `subs`, `backfilled_at`, `last_error`; `video_meta_log`'a `thumb_url`, `source`.
- **Testler.** `tests/velocity.test.js` (12), `tests/tracking.test.js` (4), `tests/niche.test.mjs` (13: RSS fikstürleri uzun + Shorts, dHash/BMP, liste senkronu, rss işi, başlık + thumbnail değişikliği, 50'lik toplu `videos.list` ve 40 günlük katman geçişleri, kota ertelemesi, kayıp video, `channel-stats` + `backfill`, `resolve`, sayfa ölçümleri, hızlı yükselen + eşik + ack, sayfa ve MCP sorguları 10 haftalık simülasyonda, haftalık özet işi), `tests/mcp.test.mjs`'e uçtan uca niş testi (org → takip, `/settings` niş ayarları, sayfa, ack, 5 araç). Fikstürler `dev/youtube/niche/` (`rss-long.xml`, `rss-shorts.xml`, `api-videos.json`, `api-channels.json`). `npm test`: **250/250** (faz 0: 220).
- **Demo.** `dev/niche-sim.mjs` (10 haftalık deterministik takip simülasyonu, gerçek tablolara yazar) ve `dev/make-niche-fixture.mjs` (gerçek `nichePage`'i çalıştırıp `dev/youtube/niche/page.json` + yerel SVG thumbnail'ler üretir). `dashboard-demo.html#/niche` (`?niche=empty|new|off`, `?hl=tr`), `youtube-demo.html` (Takip et, `?dark`, `?hl=tr`).
- **Ekran görüntüleri** (`docs/screenshots/phase1-*.png`): sayfanın tamamı EN açık / TR koyu, 1024 px TR açık, 390 px EN açık / TR koyu, başlangıç yardımcısı EN açık / TR koyu, takip yeni başladı TR, bridge yok, klasör başlığında "Tracked niche", kanal sayfasında Takip et + Benim kanalım TR koyu, YouTube kanal sayfası Takip et EN açık / TR koyu.

### Plandan sapmalar

- **Takip listesi ayrı bir tablo/anahtar değil, `rs:org` içinde.** Böylece senkron, yedek ve geri yükleme (geri yükleme `niches`/`tracked`'ı birleştirecek şekilde güncellendi) bedavaya geldi.
- **Video bilgisi için yeni tablo `tracked_videos`.** Planda yoktu; RSS ve API'den gelen başlık, format, yayın zamanı ve thumbnail hash'i Library'den bağımsız tutuluyor (takip edilen kanal Library'de kayıtlı olmayabilir).
- **Saatlik API ölçümleri Library kayıtlarını güncellemiyor**, sadece `video_stats`'a yazıyor (her saat yüzlerce `mergePost` revizyonu ve önbellek bozulması olmasın diye). Backfill Library'ye yazıyor. Faz 3'ün rozetleri en yeni değeri `video_stats`'tan okumalı.
- **Bildirim gecikmesi ≤ 5 dk**: uyarılar bridge'in `/settings` cevabıyla geliyor (eklentinin ayar itişi değişiklikte ya da 5 dakikada bir). Ayrı bir kanal açılmadı.
- **"Ne işe yarıyor"un skoru** 48 saatteki hız, yoksa geçilen son noktanın skoru (son 120 günün videoları).
- **`card-velocity`** (kartlarda "24 sa: 3,4×") yapılmadı; kart rozetleri faz 3'te. Paneldeki video listesine de eklenmedi.
- **`channel-growth` / `title-history`**: Library tarafı hazır; kanal sayfasındaki grafik (faz 3) ve izleme sayfasındaki geçmiş (faz 4) sonra. Özellikler sekmesinde ikisi de "hazır" görünüyor.
- **İlk haftalık özet** bir sonraki pazartesi; o zamana kadar sayfa bu haftanın gidişatını gösteriyor.
- **Dil.** Niş Takibi sayfası, Takip et butonları ve bildirim TR/EN; Library'nin geri kalanı faz 0'daki gibi İngilizce.

### Faz 2 için bilinmesi gerekenler

- Kendi kanal `tracked_channels.mine = 1` olarak nişte; kendi videoların tracker ölçümleri (`video_stats`) zaten var. "Kanalım" sayfasının "son 48 saat" kartı ve video karnesi `videoVelocity(store, { video })` ve `loadModel` (aynı eğri/skor) kullanabilir; niş medyanı için `nichePage().mine` hesabı (`mineVsNiche`) hazır.
- Yeni bridge uçları `/youtube/niche/*` düzeninde; servis worker'da tek bir yönlendirici (`reelscope:niche`). Faz 2 `own_*` için aynı kalıbı (`/youtube/own/*`) kullanabilir.
- Sonraki migration **3**. `MIGRATIONS`'a ekle, tabloyu `migrate()`'teki "her seferinde" bloğuna da koy.
- Batch iş türü hazır (`batchSize`, `runBatch`); Analytics'in video başına günlük çağrıları için işe yarar.
- TR/EN için `niche-view.js`'teki `S.en / S.tr` tablosu ve `F.uiLang()` kalıbı.
- Demo için gerçek sorgu kodunu simüle veriyle çalıştırıp JSON üreten `make-niche-fixture.mjs` kalıbı kullanışlı oldu.
- Kurulum: birleştirdikten sonra `launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge` (eski bridge'de `niche` özelliği yok; sayfa "bridge eski" der).

### Açık konular

- Gerçek Chrome'da (yüklü eklenti, gerçek bridge, gerçek RSS ve Data API) uçtan uca denenmedi; ağ istekleri testlerde sahte. İlk gerçek çalıştırmada bakılacaklar: RSS gecikme kararı, `UUSH` akışının bütün kanallarda gelip gelmediği, thumbnail hash'in ffmpeg/sips ile gerçek görsellerde verdiği mesafe (eşik 10 bit).
- Excel listesindeki 15 isim, Library'deki kanal adı/handle ile eşleşiyor; adı farklı kaydedilmiş bir kanal (ör. "Excel Champs" yerine başka bir yazım) seçili gelmez, kullanıcı elle işaretler.
- 16 kanal × 500 eski video haftalık ölçülürse ~160 birim/hafta; kota rahat, ama `backfillMax` ayarlanabilir.

## Faz 2 notları

*2026-11-21, dal `claude/faz2-kanalim-213479` (`youtube-niche` / faz 1 üstüne).*

### Yapılanlar

- **Kanal başına token (`mcp/youtube-analytics.mjs`).** Her bağlı kanal `~/.openoutlier/youtube-token-<UC…>.json` (0600, atomik yazım). Eski tek `youtube-token.json` ilk kullanımda yeni adına taşınır; kanal kimliği bilinmiyorsa (bağlanırken kanal sorgusu düştüyse) eski dosya olduğu gibi çalışmaya devam eder, `own-channels` işi kanalı bulunca taşır (`adoptLegacyToken`). Varsayılan kanal = ilk bağlanan (`connected_at`); yeniden bağlanma sırasını korur (`reconnected_at`). `pickToken`/`readToken(channel)`: UC kimliği, `@handle`, `yt/handle` ya da adın bir parçası. Bağlanma ekranı `prompt=consent select_account` ile açılır, böylece "Kanal ekle" başka bir Google hesabıyla yapılır (kardeşin kanalı). `invalid_grant` o kanalın dosyasına `reconnect` işareti koyar; sayfa o kanal için "Yeniden bağlan" der. **Bağlantıyı kes** sadece o kanalın token'ını siler ve Google'dan iptal ister; toplanan veri kalır.
- **Gelir izni.** `SCOPES`'a `yt-analytics-monetary.readonly` eklendi. `status()` kanal başına `needs_reconsent` (token'da bu izin yok) ve `reconnect` döner; Library mavi bir banner ve **Yeniden bağlan** düğmesi gösterir, gelir kartı da aynı düğmeyi taşır. Kanal YPP'de değilse Google parasal raporları 403 ile reddeder: `revenue_state = not_monetized`, hata değil, kart "YPP'ye girince burada görünecek" der. İzin yoksa istek hiç atılmaz (`needs_scope`). Veri gelip hepsi sıfırsa `none`. Gelir USD olarak istenir (`currency=USD`).
- **Toplama (`mcp/own-history.mjs`, tracker'da `OWN_KINDS`, hepsi `own-history` özelliğine bağlı, Data API anahtarı birimi harcamaz).**
  - `own-channels` (5 dk, tekil; sadece bir OAuth istemcisi kuruluysa tohumlanır, tracker her tick'te `seedIf` olan tekilleri yeniden dener): token dosyaları → `own_channels`; her kanal için aşağıdaki işler; token'ı giden kanalın işleri silinir, `active = 0`, verisi kalır.
  - `own-backfill:<UC>`: bugünden kanalın açıldığı güne (`snippet.publishedAt`) **180 günlük** parçalar, en yeniden eskiye (sayfa hızlı dolsun diye), çalışma başına 6 parça, aralarında 1 dk. İlerleme `own_channels.backfill_from`; bitince `backfill_done = 1` ve iş silinir.
  - `own-daily:<UC>` (~06:00 yerel): son 7 gün yeniden (düzeltmeler üzerine yazılır, API'nin göndermediği alanlar kalır), `channels.list mine=true` ile abone/izlenme/video sayısı, kilometre taşları.
  - `own-videos:<UC>` (~06:20): yüklemeler listesi (`playlistItems`, yalnız public) → son 90 günün videoları `own_videos`'a (başlık, yayın zamanı, süre, format: Library → tracker → süre ≤ 60 sn ya da ≤ 3 dk + `#shorts`); video başına `dimensions=day&filters=video==ID`, ilk seferde yayın gününden, sonra son 7 gün.
  - `own-weekly:<UC>` (~06:40): kırılımlar Analytics haftası (Pzt–Paz, Pasifik) başına `own_breakdowns`'a: `traffic`, `search_terms` (`insightTrafficSourceDetail`, `YT_SEARCH`, ilk 25), `countries`, `age_gender` (`viewerPercentage`), `devices`, `subscribed`, `playback`. İlk seferde son 12 tam hafta; sonra son iki hafta, bittikten 4 gün sonrasına kadar (sayılar oturana dek) yeniden. Reddedilen tür `{ rows: [], error }` olarak yazılır, diğerleri etkilenmez.
  - Günlük satırdaki alanlar (`own_daily.metric`): `views, engaged, minutes, avg_dur, avg_pct, subs_gained, subs_lost, likes, comments, shares`, ayrı sorgularla `impressions, ctr` (gün bazında thumbnail erişimi), `shorts_views, shorts_minutes, long_views, long_minutes` (`dimensions=day,creatorContentType`; YPP'nin uzun video saati ve 90 günlük Shorts izlenmesi için) ve gelir alanları (`revenue, ad_revenue, gross_revenue, cpm, playback_cpm, monetized_playbacks, ad_impressions`). Erişim ya da içerik türü sorgusu reddedilirse kanal `reach_state` / `ct_state = unsupported` olur; eski tarihler için gelen bir ret (backfill) yeni günlerde çalışan bir durumu bozmaz.
  - "Şimdi topla": `POST /youtube/own/refresh` kanalın işlerini bir sonraki tick'e alır. Google'dan geri dönüşte bridge bunu kendiliğinden yapar.
- **Hesaplar (`src/own-metrics.js`, UMD, bridge + Library + testler).** Gün → hafta (Pazartesi) / ay; toplamlar, TO gösterime göre, ortalama izlenme % izlenmeye göre, CPM paraya dönüşen oynatmaya göre ağırlıklı; RPM = gelir ÷ izlenme × 1000. Abone toplamı Data API'nin bugünkü sayısına bağlanarak geriye doğru (Analytics sadece kazanılan/kaybedileni verir). Karşılaştırma: son N gün ve önceki N gün (`covered`: önceki pencere toplanan geçmişin içinde değilse yüzde yok, yeni kanala "+∞ %" denmez). **YPP ETA:** son 28 günün hızı (geçmiş daha kısaysa o kadar, en az 7), gelecek her gün pencereden çıkan günü düşerek simüle edilir (en çok 3 yıl), 14 günden az geçmişte tahmin yok; abone doğrusal; yol başına ikisinin geç olanı; iki yolun en yakını "en yakın". Kilometre taşları: 10/100/500/1.000/5.000… abone, 1K…100M toplam izlenme, 100/1.000/4.000/10.000 saat, 1K/10K/100K/1M izlenmeli ilk video; ulaşıldığı gün kümülatif seriden.
- **Kilometre taşı bildirimi.** Yeni özellik `own-milestones` (varsayılan kapalı, plan "bildirim isteğe bağlı" diyor). `own_milestones` tablosu; bir kanalın ilk hesabında hepsi "gösterildi" sayılır (eski başarılar bildirim yağdırmaz). Bridge'in `/settings` cevabı `own.milestones` taşır; servis worker özellik açıksa Chrome bildirimi gösterir (tıklayınca `#/my-youtube`) ve her durumda `/youtube/own/milestones/ack` ile işaretler.
- **Library → Kanalım (`dashboard/youtube-channel-view.js`, TR/EN).** Bridge'den tek cevap (`GET /youtube/own/page?channel=UC…|all`, servis worker'da `reelscope:own`). Başlıkta kanal avatarı ve adı; birden çok kanalda avatarlı seçici + **Birleşik** (seçim `localStorage`'da). Banner'lar: gelir izni (mavi, Yeniden bağlan), süresi dolan oturum (sarı), özellik kapalı, eski bridge. Geçmiş yüklenirken yüzdeli bir "toplanıyor" kartı ve 20 sn'de bir kendiliğinden yenileme. KPI şeridi (abone, 28 günlük izlenme / saat / TO / ort. izlenme %, önceki 28 güne göre). **İlerleme:** abone (alan + çizgi), izlenme, izlenme süresi (çubuk), TO, ort. % (çizgi); gün/hafta/ay, 7/28/90/365/tümü; önceki dönem kesik çizgiyle; üzerine gelince o günün okuması; altta 7/28/90/365 gün değişim çipleri; büyük harfli cümle ("son 28 günde 675 izlenme; önceki 28 güne göre −13 %"), kanal pencereden gençse "kanalın Analytics'teki ilk 8 gününde 21 izlenme". **Video karnesi:** son 90 günün yüklemeleri; 48 sa / 7 g / 30 g (takipte saatlik kontrol noktası, yoksa ilk 2/7/30 Analytics günü), kanal medyanının katı (≥ 3 videoda), nişin medyanı (faz 1'in benzer büyüklükteki kanallar mantığı, `peerMedians`), dolmamış hücrelerde "22 Kas" tarihi. **Seni bulan arama terimleri** (4 hafta, geçen hafta / önceki hafta farkı, yeni terim rozeti, 8 haftalık kıvılcım). **Trafik, coğrafya (`Intl.DisplayNames`), yaş ve cinsiyet (yığılmış çubuk), cihaz / abonelik / oynatma yeri.** Yan sütun: **YPP** (çubuklar, yol başına ETA, en yakın yol vurgulu, genel ETA kutusu; YPP'deyse rozet; içerik türü ayrılmadıysa "Shorts dahil, yaklaşık" notu), **Son 48 saat** (tracker'ın saatlik ölçümleri: toplam kazanç, 48 saatlik alan grafiği, en çok kazanan videolar), **Kilometre taşları** (sıradakiler ilerlemeyle, ulaşılanlar tarihle, bildirim kutusu), **Gelir** (28 gün, önceki 28'e göre, RPM ve CPM kutuları, 365 gün), **Kâr hesaplayıcı** (video ve Short başına maliyet, para birimi, dönem → yükleme sayısı, maliyet, gelir, net (yalnız USD'de), başa baş RPM; ayarlar `rs:settings.ownProfit` kanal başına), **Bağlı kanallar** (durum, geçmiş yüzdesi, Yeniden bağlan / Bağlantıyı kes, **+ Kanal ekle** ve aile üyesi notu). Birleşik görünümde karne, YPP ve kilometre taşları yerine **Kanallar yan yana** tablosu (abone, 28 gün izlenme ve değişim, saat, abone, YPP çubuğu/ETA). Eski canlı tablo (video başına izlenme %, gösterim, TO, izleyici tutma eğrisi) **Video ayrıntıları** altında, istenince açılır. Grafik telefonda kendi genişliğinde çizilir (eksen yazıları okunur kalır).
- **MCP (`mcp/own-tools.mjs`).** `my_channel_history` (gün/hafta/ay, 7/28/90/365 karşılaştırma), `my_video_history` (karne; `video` ile o videonun günlük satırları), `my_search_terms`, `my_ypp_progress`; hepsi `channel` alır, verilmezse ilk bağlanan kanal. Mevcut `my_youtube_channel`, `my_youtube_videos`, `my_youtube_retention` da `channel` aldı, onsuz eskisi gibi çalışır; `connect_youtube_channel` bağlı kanalları listeler ve `channel` ile yeniden bağlar. README tablosunda.
- **Özellikler.** `own-history`, `own-revenue`, `own-milestones` `available: true`.
- **Migration 3 (`store.mjs`).** `own_channels`, `own_videos`, `own_milestones`; `own_video_daily.channel_id` + indeks.
- **Bridge.** `features`'a `own-history`; `/youtube/own/page`, `/youtube/own/refresh`, `/youtube/own/milestones/ack`; `/youtube/analytics/*` `channel` parametresi alır (servis worker UC kimliğini doğrular); `/settings` cevabında `oauth.channels / needs_reconsent / reconnect` ve `own`.
- **Testler.** `tests/own-metrics.test.js` (8: gün/hafta/ay, ağırlıklı oranlar, kümülatif, karşılaştırma ve kapsama, doğrusal ETA, kayan pencereli ETA (eski günlerin düşmesi, "bu hızla olmuyor"), YPP iki yol, kilometre taşları), `tests/own-history.test.mjs` (9: Analytics fikstürleri → alanlar ve hata kodları (yetkisiz, para kazanmıyor, desteklenmeyen sorgu, kota), tek token dosyasının taşınması ve kimliksiz eski token, iki kanal ekleme / seçme / yeniden bağlama / iptal / kesme, backfill parçaları (180 gün, en yeniden eskiye, bitişik, ilk güne kadar, gecikme), günlük iş ve düzeltmeler, gelir: izin yok / YPP / YPP dışı, erişim ve içerik türü desteklenmiyor, video ve haftalık işler + karne + arama terimleri + kitle, kesilen kanal, çok yeni kanal), `tests/mcp.test.mjs`'e uçtan uca (sayfa, birleşik, şimdi topla, ack, 4 araç `channel` ile). Fikstürler `dev/youtube/own/fixtures/` (gün serisi, gün bazında erişim, video gün serisi, gelir, arama terimleri, trafik, yaş-cinsiyet, 4 hata). `dev/own-sim.mjs`: kanalları simüle eden sahte Google (OAuth, Analytics raporları, Data API). `npm test`: **268/268** (faz 1: 250).
- **Demo.** `node dev/make-own-fixture.mjs` gerçek işleri sahte Google'a karşı çalıştırıp `dev/youtube/own/<durum>.json` üretir. `dashboard-demo.html#/my-youtube?ytanalytics=` `connected` (YPP'ye ~2 ay kalan kanal), `two` (Hands on Excel, Excel nişinde takipte, 1 abone + Quran kanalı + birleşik), `tiny` (9 günlük kanal), `monetized`, `reconnect`, `collecting`, `oldbridge`, ayrıca eski `setup`, `connect`.
- **Ekran görüntüleri** (`docs/screenshots/phase2-*.png`): `kanalim-two-en-light` (tam sayfa), `kanalim-combined-tr-dark`, `kanalim-quran-en-dark`, `kanalim-connected-tr-dark` (tam), `kanalim-monetized-en-light`, `kanalim-reconnect-en-light`, `kanalim-collecting-tr-light`, `kanalim-tiny-en-light` (tam), `kanalim-medium-tr-light` (1024 px), `kanalim-narrow-tiny-en-light` (390 px, tam), `kanalim-narrow-two-tr-dark` (390 px), `kanalim-setup-tr-light`, `kanalim-connect-en-dark`, `kanalim-oldbridge-en-light`, `library-settings-own-features-en-light`.

### Plandan sapmalar

- **Ek tablolar** `own_channels` (toplama durumu, abone sayısı, gelir/erişim/içerik türü durumları), `own_videos`, `own_milestones`; planda sadece `own_daily`, `own_video_daily`, `own_breakdowns` vardı.
- **Kırılımlar haftalık anlık değer değil, hafta başına satır.** Sayfa son 4 haftayı toplar; arama terimlerinin hafta hafta değişimi bu yüzden mümkün. Geçmişe sadece 12 hafta gidilir (kırılımlar için uzun geçmiş istenmedi).
- **YPP saatleri `creatorContentType` ile.** YPP sadece public uzun video saatini sayar; Analytics günlük içerik türü kırılımını verirse uzun video dakikası, vermezse toplam dakika kullanılır ve sayfa "Shorts dahil, yaklaşık" der. Private/unlisted/silinmiş video ayrımı yapılmaz; resmi sayı Studio'daki.
- **Video karnesinde iki kaynak.** Kanal nişte takipteyse saatlik ölçümün kontrol noktası (48/168/720 sa), değilse ilk 2/7/30 Analytics günü (Pasifik günleri). Hücrenin `src` alanı hangisi olduğunu söyler.
- **"Son 48 saat" sadece takip edilen kanallarda.** Kaynak faz 1 tracker'ı; Quran kanalı Excel nişine girmediği için o kartta "takibe al" boş durumu görünür (bölüm 3.2: Quran kendi nişiyle ayrı takip edilebilir).
- **Analytics işleri kota bütçesine girmez** (`units: 0`): Analytics API'nin kotası ayrı, `channels/playlistItems/videos` çağrıları OAuth istemcisinin projesinden düşer, bridge'in anahtar sayacına yazılmaz.
- **Kâr hesaplayıcının neti yalnız USD'de.** Gelir USD geliyor; kur çevirisi yapılmadı, başka para biriminde sadece maliyet ve başa baş RPM gösterilir.
- **Birleşik görünüm** kanalların ortak son Analytics gününe kadar toplar; YPP, karne ve kilometre taşları kanal başına (birleşikte "Kanallar yan yana").
- **Kilometre taşı bildirimi ayrı bir özellik** (`own-milestones`, kapalı) — faz 0 kaydında yoktu.

### Faz 3 için bilinmesi gerekenler

- Sonraki migration **4**.
- Bridge özelliği `own-history`; sayfa cevabı `ownPage(store, { channel })` (`mcp/own-history.mjs`). Kendi videolarının günlük Analytics satırları `own_video_daily` (+ `channel_id`), başlık/format `own_videos`'ta; video sayfası kartı (`video-card`) kendi videon için bunlardan "Analytics'e göre" satırı gösterebilir.
- `src/own-metrics.js` UMD; içerik script'lerinde de kullanılabilir.
- Kanal başına token: Analytics'e dokunan her yeni kod `YA.readToken(channel)` / `{ channel }` seçeneğini geçmeli; `channel` verilmezse ilk bağlanan kanal kullanılır.
- Servis worker'da `reelscope:own` (sayfa / refresh) ve `reelscope:yt-analytics`'e `channel`.
- Kurulum: birleştirdikten sonra `launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge`; ilk açılışta mevcut `youtube-token.json` yeni adına taşınır ve sayfa gelir için bir kez yeniden onay ister.

### Açık konular

- **Canlı Analytics ile denenmedi** (gerçek token'a dokunulmadı). İlk gerçek çalıştırmada bakılacaklar: `videoThumbnailImpressions*`'ın `dimensions=day` ile kanal raporunda kabul edilip edilmediği (edilmezse TO boş kalır, `reach_state = unsupported`), `creatorContentType`'ın `day` ile birlikte çalışması, `videoThumbnailImpressionsClickRate`'in kesir mi yüzde mi döndüğü (faz 5'teki gibi kesir varsayıldı), YPP dışı kanalda parasal raporun gerçekten 403 döndüğü, `subscribedStatus` / `insightPlaybackLocationType` değer adları.
- Analytics'in 2–3 günlük gecikmesi yüzünden "Analytics … tarihine kadar" en fazla dünü gösterir; bugünkü satır her zaman eksik sayıldığından karşılaştırmalara girmez.
- Hands on Excel çok küçük olduğu için arama terimleri ve kitle kırılımları ilk haftalarda boş ya da "YouTube bunu vermiyor" çıkabilir; sayfa bunu boş durumlarla anlatıyor.
- Kardeşin kanalını bağlamak için onun Google hesabının OAuth izin ekranında **test kullanıcısı** olarak eklenmesi gerekir (README'de yazıyor).

## Faz 3 notları

*2026-11-21, dal `claude/faz3-rozetler-4b6984` (`youtube-niche` / faz 2 üstüne).*

### Yapılanlar

- **Saf hesaplar (`src/yt-insights.js`, UMD, `tests/yt-insights.test.js`).** VPH (izlenme ÷ yayından beri saat; ilk saat 1 saat sayılır; yuvarlak izlenme ya da göreli tarihte `≈`), outlier (`libraryBaseline`: kayıtlı kanalın format başına medyanı, Library'nin kuralıyla 72 saatten genç ve sabitlenmiş videolar hariç, en az 5 video; `outlier(views, type, formula, lib, ch)`: medyan → kanal ortalaması (`channels.list` toplam izlenme ÷ video sayısı) → kayıtlı videoların ortalaması; hangisi olduğu `basis`/`source` ile döner), etkileşim (beğeni + yorum ÷ izlenme × 100, en çok 100), monetization (`monetizationFromHtml`: NexLev'in `[{"key":"yt_ad","value":"` işareti → `yes`, müzik başlığı (`richListHeaderRenderer` "Music") → `music`, işaret yok → `no`, rıza/hata/izleme sayfası olmayan → `unknown`), örnekleme (`sampleIndices`: 0, %25, %50, %75, son; `sampleVideos`: yalnız uzun videolar, yeniden eskiye, üyelere özel ve canlı hariç; sadece Shorts → `shortsOnly`), kanal kararı (bir reklam yeter), filtre yüklemleri (`matchItem`: veri yoksa kriter düşer ve `missing`'de söylenir; Shorts "4 dk altı" sayılır), TTL önbellek (`cacheGet/cachePut`, en yeniler kalır), kayan pencereli hız sınırı (`waitFor`, `limiter`), kanal istatistikleri (`channelStats`: yaş, toplam, ortalama (kanal ya da kayıtlı), medyan, aylık yükleme (son 90 gün → kayıtlıların aralığı → kanal ömrü), ortalama süre, Shorts var mı, ülke), büyüme ve kıvılcım çizgisi, TR/EN etiketler (`3,4×`, `≈1,2 B/sa`, `24 sa`).
- **Kart ayrıştırıcı (`src/youtube.js` → `parseCards`, `parseMetaTexts`).** Herhangi bir YouTube JSON'unda (arama, ana sayfa, abonelikler, izleme sayfası yan listesi, kanal ızgarası, devam yanıtları) her video öğesini bulur: `lockupViewModel` (avatardan ya da yan listede ilk metadata satırının bağlantısından kanal), `videoRenderer`/`compactVideoRenderer`/`gridVideoRenderer`/`playlistVideoRenderer` (`ownerText`/`longBylineText`/`shortBylineText`), `reelItemRenderer`, `shortsLockupViewModel`; mevcut öğe ayrıştırıcılarını yeniden kullanır. Arama ve yan liste uzun sayıyı ("801,352 views") da verdiği için oradaki izlenme kesin sayılır; `/shorts/` bağlantılı arama sonucu Short olur; mix/oynatma listesi atlanır. `parseMetaTexts` DOM yedeği (kartın görünen metni, EN/TR). `hook.js` artık `/youtubei/v1/search` yanıtlarını da iletiyor.
- **Kart rozetleri, filtreler, Shorts gizleme, kanal sıralama (`src/youtube-cards.js`).** Rozetler küçük resmin sol üst köşesinde, mutlak konumlu (`<oo-cq>` / `<oo-badges>` / `<oo-b>`, tek bir stil sayfası; YouTube'un süre rozeti sağ altta, hover düğmeleri sağ üstte), sayfa kaymaz. Sırayla outlier (≥ 2× lime üstünde ink; ortalamada küçük "avg/ort." eki), hız (takip edilen videolar, mavi, "24 sa: 3,4×"), VPH, abone. Dar küçük resimlerde container query ile önce abone, sonra VPH düşer. Her çipte ne olduğunu anlatan `title`. Veri sırası: bridge'in son ölçümü (`video_stats`) ve takip edilenlerde yayın anı → Library'deki kesin kayıt → kartın yanıt verisi → DOM metni. Kanal: Library (UC → hesap dizini, handle), `channels.list` önbelleği, bridge'in takip edilen kanal bilgisi. İstekler 600 ms'lik toplu gönderimle: `reelscope:yt-channels` (sadece medyan yoksa, formül ortalamaysa ya da abone sayısı bilinmiyorsa; anahtar yoksa bir daha sormaz) ve `reelscope:yt-cards` (bridge, 300 video + 100 kanal). Yeni kartlar `MutationObserver` ile (kendi düğümlerimiz yok sayılır), geri dönüştürülen kartlarda video kimliği değişince yeniden çizilir, sadece metni değişen rozet DOM'a dokunur, dakikada bir VPH tazelenir. **Filtreler** sonuçların üstünde ince bir çubuk (shadow DOM, YouTube çipi görünümü): en az outlier, VPH, izlenme, abone başına izlenme, yükleme tarihi, süre, Shorts'u gizle; "yalnız yüklenenler" notu, "N videodan M'i", "veri olmadığı için gizlenen N", sıfırla. Filtre açıkken mix'ler ve tamamı gizlenen raflar (Shorts rafı) da gizlenir. Filtreler sekme oturumunda sayfa türü başına (`sessionStorage`). **Aramada Shorts'u gizle:** `html[data-oo-hide-shorts]` ve `:has()` kurallarıyla raflar ve `/shorts/` sonuçları. **Outlier'a göre sırala:** kanalın Videolar/Shorts/Canlı sekmesinde, ızgara flex/grid ise CSS `order` ile (DOM taşınmaz, devam öğesi sonda kalır); kapatınca YouTube'un sırası döner; satır tabanlı eski düzende "yeniden sıralanamıyor" der.
- **Sayfa kartları (`src/youtube-pages.js`).** *Kanal:* başlığın altında (sekmelerden önce) istatistik kartı: yaş (gün, "… tarihinden beri"), toplam izlenme, video başına ortalama ve medyan (kaynağıyla), aylık yükleme, ortalama süre, Shorts, ülke (`Intl.DisplayNames`), Monetized rozeti, takip edilen kanalda günlük abone kıvılcımı (+fark, gün). Anahtar yoksa "yaş, toplam izlenme ve ülke için API anahtarı" notu. Faz 1'in Takip et butonu yerinde, aynı stil ailesinde. *İzleme sayfası:* beğen/paylaş satırının altında, açıklamanın üstünde: Monetized rozeti, outlier, ömür boyu VPH, son 24 saat VPH, etkileşim, hız eğrisi (video düz, kanalın normali kesik; "7 g: 2,6×"), dislike (RYD, "via Return YouTube Dislike" linkiyle). Kendi videonda (`own_video_daily`) "YouTube Analytics: izlenme · saat · ort. izlenme % · +abone · … tarihine kadar". *Shorts:* videonun solunda dikey kart (VPH, yayın zamanı, kanal yaşı, kanalın ortalama Shorts izlenmesi); yer yoksa videonun üstünde, YouTube'un oynat/ses satırının altında tek satır. Kartlar sabit yükseklikle hemen yerleşir, sayılar sonradan dolar; hücreler dar ekranda satır başında çizgi bırakmadan sarar. Hepsi YouTube'un `html[dark]` temasına uyar.
- **Servis worker (`src/youtube-insights-bg.js`).** `reelscope:yt-channels`: `channels.list` (snippet + statistics; `publishedAt` ve `country` `channelInfo`'ya eklendi, istemciye 50'lik `channels()`), 7 gün önbellek (`rs:yt-ch-cache`, en çok 4.000; YouTube'un bilmediği kanal `null`, 1 gün), sekmeler arası aynı kanal için tek istek, günün kotası 9.000'i geçtiyse sormaz, birimler `youtube-api-bg.js`'in sayacına. `reelscope:yt-monetization`: kuyruk, tek tek; dakikada en çok 10 sayfa (zaman damgaları `chrome.storage.session`'da, worker yeniden başlasa da sınır korunur); izleme sayfası önce çerezsiz (`credentials: 'omit'`), rıza sayfası gelirse bir kez çerezle; video ve kanal sonuçları 7 gün (`rs:yt-mon-cache`; kontrol edilemeyen kanal 1 gün); kanal ilk reklamda durur; ilk cevap `checking`, sonuç depoya düşer, açık sekmeler `storage.onChanged` ile günceller. `reelscope:yt-ryd`: `returnyoutubedislikeapi.com/votes`, 1 gün önbellek (`rs:yt-ryd-cache`), 8 sn zaman aşımı, hatada sessiz (`ok: false`). Özellik kapalıyken hiçbir istek atılmaz.
- **Bridge (`mcp/cards.mjs`, `/health` → `cards`).** `POST /youtube/cards` (en yeni `video_stats` satırı her video için, takip edilenlerde yayın anı ve hız skoru, takip edilen kanalların abone/izlenme/video ve format başına tipik izlenmesi), `GET /youtube/channel-card?channel=UC…` (faz 1'in `growthOf`'u, artık dışa açık), `GET /youtube/video-card?id=` (son 24 saat VPH, hız, kontrol noktalarında video ve beklenen, `own_video_daily` toplamları). Servis worker'da `reelscope:yt-cards` (bridge yoksa ya da eskiyse sessizce boş).
- **Özellikler.** `available: true`: `card-vph`, `card-outlier`, `card-subs`, `card-velocity`, `feed-filters`, `hide-shorts`, `channel-sort`, `channel-stats`, `channel-monetization`, `video-card`, `video-monetization`, `dislikes`, `shorts-overlay` (`channel-growth` zaten hazırdı; kanal sayfası grafiği bu fazda geldi). **Outlier formülü** bir seçim: `F.CHOICES.outlierFormula` (`median` | `mean`), `rs:settings.outlierFormula`, `F.choice()` / `F.setChoice()`, `reset()` siler, `onChange` hangi seçimin değiştiğini söyler; Özellikler listesinde Outlier rozeti satırının altında iki düğmeli seçici (panel ve Library aynı kod).
- **Testler.** `tests/yt-insights.test.js` (14: VPH ve ≈, medyan/ortalama ve etiketler, etkileşim, yt_ad fikstürleri (monetized, değil, müzik, rıza), örnekleme ve karar, filtreler, önbellek, hız sınırı (sahte saat, 25 çağrı), kanal istatistikleri, büyüme, TR/EN etiketler, `parseCards` arama / ana sayfa / abonelikler / yan liste / kanal ızgarası, `parseMetaTexts` EN/TR), `tests/insights-bg.test.js` (5: sahte chrome + fetch + saat ile `channels.list` toplu istek ve önbellek, anahtarsız/kota az, monetization kuyruğu, kanal ilk reklamda durur, 13 istekte dakikada 10, kapalıyken istek yok, RYD önbellek ve hatalar), `tests/cards.test.mjs` (3: bridge sorguları), `tests/mcp.test.mjs`'e uçtan uca rota testi, `tests/features.test.js` (hazır listesi, seçim, tarayıcıda seçim ve sıralı yazım). Fikstürler `dev/youtube/cards/` (`node dev/make-cards-fixture.mjs`). `npm test`: **294/294** (faz 2: 268).
- **Demo.** `dev/youtube-demo.html?surface=home|search|subscriptions|watch|channel|shorts` (`dev/youtube-surfaces.js`: YouTube'un eleman adlarıyla sade taklit sayfalar, açık/koyu), `?ytapi`, `?bridge=off`, `?own`, `?mon=no|unknown|music`, `?ryd=fail`, `?on=…`, `?off=…`, `?formula=mean`, `?hl=tr`, `?dark`.
- **Ekran görüntüleri** (`docs/screenshots/phase3-*.png`, 23): `home-en-light`, `home-tr-dark-medium` (1024), `home-filters-en-light`, `home-filtered-tr-light`, `home-narrow-en-dark` ve `home-narrow-filters-tr-light` (390), `home-mean-formula-en-light`, `search-en-light`, `search-hide-shorts-tr-dark`, `subscriptions-en-dark`, `watch-own-en-light`, `watch-tr-dark`, `watch-medium-tr-light`, `watch-narrow-en-light`, `channel-sorted-en-dark`, `channel-tr-light`, `channel-narrow-tr-dark`, `channel-nokey-en-light`, `shorts-en-light`, `shorts-tr-dark`, `shorts-narrow-en-dark`, `features-tab-en-light`, `features-tab-tr-dark`. Canlı kapatma Playwright'la denendi: her rozet anahtarı kendi çipini, hepsi kapanınca rozetler, filtre çubuğu, Shorts gizleme, sıralama çubuğu, izleme/kanal/Shorts kartının her parçası yenilemeden gidiyor ve geri geliyor.

### Plandan sapmalar

- **Yeni tablo ya da migration yok.** Kartlar mevcut tablolardan okur; sonraki migration hâlâ **4**.
- **`card-subs` artık API anahtarını gerektirmiyor**, isteğe bağlı: abone sayısı kayıtlı kanaldan, sayfadan (izleme sayfası sahibi) ve takip edilen kanaldan da gelir. **`card-velocity`** kayıtta faz 1'den 3'e alındı (bu fazda yapıldı).
- **`channel-rpm`** (faz 3 olarak kayıtlı, varsayılan kapalı) yapılmadı, "Yakında" kaldı: görev listesinde yoktu ve kategori tablosu ayrı bir karar istiyor.
- **Dislike sayısı YouTube'un dislike düğmesine yazılmıyor**, izleme kartında gösteriliyor (atıfla birlikte). Düğmenin içi sık değişiyor; kartta kırılma riski yok.
- **Ortalama formülünde Shorts:** `channels.list` toplamı Shorts ve uzun videoları karıştırır; ortalamalı rozet bunu "avg" etiketiyle söyler ama format ayırmaz (NexLev de ayırmıyor).
- **Monetization isteği çerezsiz başlar**; sadece rıza sayfası dönerse bir kez çerezle tekrarlar. `&hl=en&gl=US` ile istenir (müzik başlığı İngilizce okunur).
- **Filtre çubuğu sonuçların üstüne bir satır ekler** (sayfa açılırken bir kez ~44 px); rozetler hiç kaydırmaz. Filtre ayarları kalıcı değil, sekme oturumu boyunca.
- **Etiket dili:** kart verisi, içindeki kelimeler dili söylüyorsa (`views` / `görüntüleme`) onunla, yoksa `<html lang>` ile okunur (Türkçe arayüzde İngilizce veri gelirse yanlış birimle okunmasın diye).
- **`features.js` yazımları sıraya kondu.** Aynı anda iki anahtar değişince biri kayboluyordu (oku-değiştir-yaz yarışı); `set`, `setChoice`, `reset` artık tek tek yazıyor.
- **Manifest'e `https://returnyoutubedislikeapi.com/*` eklendi.** Paketli bir sürümde Chrome yeni izin için uyarı gösterir; açılmış klasörde yeniden yüklemek yeter.

### Faz 4 için bilinmesi gerekenler

- İçerik script'leri arasında paylaşılan yardımcılar: `self.OpenOutlierYTData` (`youtube-cards.js`): `videoFacts(id)` (tek videonun bütün sayıları ve kaynakları), `accountOf`, `baselineOf`, `profileOf`, `channelInfo`, `requestChannels`, `bridgeVideo/Channel`, `send`, `onData`, `activePage` (YouTube gizli eski sayfaları DOM'da tutar; hep görünür olanda çalış), `pageKind`. Library'nin bu sekmedeki kopyası `self.OpenOutlierYTLib` (`youtube-content.js`): `accounts`, `profiles`, `ucMap`, `findPost`, `pageAccount`, `onChange`.
- İzleme sayfası kartı (`youtube-pages.js` → `watchCard`) yeni hücrelere hazır: transcript/yorum araçları, kare yakalama ve `title-history` (faz 1 verisi, `/youtube/niche/video` → `title_thumbnail_log`) aynı kartın altına ya da yanına gelebilir. Kart hostları shadow DOM, `draw(host, sig, build)` sadece imza değişince çizer.
- YouTube'a yeni bir istek gerekiyorsa `youtube-insights-bg.js`'teki sınırlayıcı ve önbellek düzeni kullanılmalı ve README'deki Privacy maddesine eklenmeli.
- Bridge'den okumak için `mcp/cards.mjs` düzeni (salt okunur, `reelscope:yt-cards` `what` ile).
- Demo sayfaları: `?surface=` ile yeni durumlar `dev/youtube-surfaces.js`'e eklenebilir; tarayıcı önbelleği eski script'i tutabiliyor (dinamik yüklenenler `?v=` ile kırılıyor, statik olanlar için `fetch(…, { cache: 'reload' })`).

### Açık konular

- **Gerçek youtube.com'da denenmedi** (gerçek veriye dokunulmadı). Seçiciler YouTube'un bilinen düzenine göre: kartlar `ytd-rich-item-renderer`, `yt-lockup-view-model`, `ytd-video-renderer`, `ytd-compact-video-renderer`, `ytm-shorts-lockup-view-model(-v2)`; küçük resim `yt-thumbnail-view-model` / `ytd-thumbnail`; kanal kartı `ytd-tabbed-page-header #page-header`'ın ardına; izleme kartı `ytd-watch-metadata #bottom-row`'un önüne; filtre çubuğu `ytd-rich-grid-renderer > #contents` / `ytd-section-list-renderer > #contents`'in önüne. Biri tutmazsa o parça sessizce görünmez, sayfa bozulmaz; ilk gerçek denemede bunlara bakılmalı.
- **Raflardaki Shorts'ta rozet çoğu zaman yok:** `shortsLockupViewModel` kanal ve tarih taşımıyor; sadece izlenme var. Kanal sayfasının Shorts sekmesinde (kanal bilinir) outlier çıkıyor.
- YouTube'un ana sayfa hover önizlemesi rozetlerin üstünde açılır (beklenen); "izlemeye devam" kırmızı ilerleme çubuğu altta, çakışmıyor.
- Monetization sonucu YouTube'un sayfa yapısına bağlı (`yt_ad` anahtarı). Gerçek bir kanal ve müzik videosuyla doğrulanmalı. RYD API'sinin adresi ve kotası (istemci başına dakikada 100) değişirse dislike hücresi "alınamadı" der.

## Faz 4 notları

*2026-11-21, dal `claude/faz4-icerik-0a5c72` (`youtube-niche` / faz 3 üstüne).*

### Yapılanlar

- **Saf modüller (UMD, Node'da test edilir).**
  - `src/content-tools.js`: transcript okuyucular (YouTube'un transcript paneli, iki DOM düzeni: `ytd-transcript-segment-renderer` ve `transcript-segment-view-model`; NexLev'in seçicileriyle aynı sıra, a11y etiketi metne karışmaz), json3 ve srv1 XML altyazı, oynatıcı yanıtındaki `captionTracks` (dil seçimi: istenen dilde yüklenen → otomatik → ilk yüklenen), dışa aktarıcılar (düz metin paragraflı, zaman damgalı, `.srt`, 30 sn'lik bloklar ve `&t=` linkli `.md`), Claude istemleri (transcript: özet, konular, ilk 30 sn hook analizi, zaman damgalı bölüm taslağı, 3 fikir; yorum: duygu, beğenilen / beğenilmeyen, cevaplanacak sorular, 5 fikir; ikisi de MCP aracını anar), yorum ayrıştırıcı (entity biçimi: `commentViewModel` + `frameworkUpdates` `commentEntityPayload` ve `engagementToolbarStateEntityPayload` (kalp); eski `commentThreadRenderer` → `commentRenderer`; sabit, kalp, kanal sahibi, yanıt ve üst yorum; "1,2 B" / "1.2K" sayıları TR/EN), yorum filtreleri (soru: soru işareti, EN soru kelimeleri en az 3 kelimeyle, TR soru kelimeleri ve *mı/mi/mu/mü*, "what a video" gibi ünlemler hariç; küfür: TR + EN listeler, kelime başı / tam kelime, leetspeak, uzatılmış harfler, `f*ck` / `a**hole` yıldız açılımı, *Dickens*, *class*, *götürmek*, *pick*, *sikke* gibi yanlış alarmlar olmadan; ifade: aksan ve büyük/küçük harf duyarsız, virgül = herhangi biri; beğeniye / yanıta göre sıralama), CSV (formül enjeksiyonuna karşı `=…` ve `@SUM(` gibi hücreler `'` ile; `@kullanıcı` olduğu gibi) ve JSON, Studio sıkıştırma planı (`thumbPlan`).
  - `src/sponsors.js`: açıklama başına bulgular (`sponsor`, `affiliate`, `brand-link`, `utm`, `code`, `discount`, `short-link`) ve açıklama ifşası; kodlar ve indirimler aynı paragrafta öncesindeki (yoksa aynı satırda sonrasındaki) markaya bağlanır; kanalın kendi alan adı ve sosyal linkler sayılmaz; kısa linkler sayılır, açılmaz. `aggregate`: marka başına kanal / video sayısı, kodlar, ilk / son tarih, örnek satırlar; kanal başına markalar ve ifşa sayısı.
  - `src/swipe.js`: `rs:org.swipe = { v: 1, items }`; kaydet (aynı video + aynı klip → güncelle, başka klip → ikinci kayıt; `org.folders`'ta olmayan klasör düşer; en çok 2.000 kayıt), kaldır, birleştir (yedekten geri yükleme: aynı kayıtta yenisi kazanır), filtre ve sıralama, etiket / klasör sayıları, `&t=` linki (kliplenmemiş Short `/shorts/` olarak açılır), CSV / Markdown / JSON. Etiket kuralı Library'ninkiyle aynı (`İ` düzeltmesi ikisine birden yapıldı).
- **YouTube'da (`src/youtube-tools.js`, manifest'te `youtube-pages.js`'ten sonra).** İzleme sayfasında faz 3'ün kartının hemen altında YouTube çipleri (**Transcript**, **Yorumlar** (okunan sayıyla), **Kaydet** / **Kaydedildi**); bir seferde bir panel açılır, kartın görünümüyle aynı yüzey. Transcript: paneli açıp okuyup kapatır (açık değilse), yoksa oynatıcının CC ile yüklediği altyazı (`hook.js` artık `/api/timedtext` yanıtlarını da iletiyor), yoksa sayfadaki altyazı kanalı (`fmt=json3`, boşsa XML). Panel içinde arama, zamana tıklayınca atlama, kopyala (metin / zaman damgalı), indir (.txt / .srt / .md), **Claude'a gönder**. Yorumlar: `/next` yanıtlarından (hook artık yorum içeren yanıtları da iletiyor), video başına birleştirilir; tarayıcıda `oo-cache:yt-comments` (rs: değil: yedeğe ve senkrona girmez) 3 gün / en çok 25 video; 4 sn sonra bridge'e (`reelscope:yt-content` → `POST /youtube/comments`). Kaydet: klasör (Library klasörleri + yeni klasör), klip (başlangıç / bitiş, oynatma anını izleyen "Şimdi (1:23)" düğmeleri), not, etiketler (mevcut etiket önerileri), güncelle / kaldır, "Swipe file'ı aç". Araç çubuğu (`overlay.js`'e `addButton` / `barRect` / `mode` eklendi): kamera (kare kopyala / PNG indir; tainted canvas'ta açıklama), Shorts'ta ayrıca Yorumlar ve Kaydet; paneller araç çubuğundan açılan bir popover'da (Shorts'ta dikey çubuğun yanında, yer yoksa solunda). Hepsi TR/EN, YouTube'un açık / koyu temasında; Escape ve dışarı tıklama popover'ı kapatır.
- **Kartlar (`src/youtube-pages.js`).** İzleme kartına **Başlık ve thumbnail değişiklikleri** satırı (`title-history`; son 3 değişiklik: tarih, eski → yeni başlık ya da önceki → sonraki görsel, öncesi / sonrası saatlik izlenme, artış yeşil, düşüş kırmızı). Kanal kartına **Tanıttıkları** satırı (`channel-sponsors`; marka, video sayısı, üzerine gelince kod ve örnek satır). Takip edilmeyen ve açıklaması kayıtlı olmayan kanallarda satır hiç çıkmaz (her kanal sayfasında kalabalık olmasın diye).
- **Studio (`src/studio-thumb.js`, manifest'te yalnız `https://studio.youtube.com/*`).** 2 MB'tan büyük görsel seçilince ya da bırakılınca (belge ve açık shadow root'larda capture aşamasında; Studio'nun kendi işleyicisinden önce) Studio görünümünde bir diyalog: sıkıştır / orijinali kullan / vazgeç; sıkıştırma bu sekmede canvas ile (JPEG %92'den %64'e, sonra 1920 → 1632 → 1382 → 1280 px), öncesi / sonrası, "Sıkıştırılmışı kullan" dosyayı Studio'nun kendi alanına (`DataTransfer` + `change`) verir, "İndir". Hiçbir şey yüklenmez. Thumbnail bölümünün altına Thumbnail testine link (`thumb-preview`).
- **Library.** `#/swipe` (**Swipe file**): ızgara, klip rozeti, Short rozeti, not, etiketler, klasör çipi; arama, klasör (sayılarıyla), Hepsi / Videolar / Shorts, Sadece klipler, sıralama (en yeni / en çok izlenen / başlık), etiket çubuğu; yerinde düzenleme (not, etiket, klasör, klip), kaldır + geri al; CSV / Markdown / JSON (filtrelenmiş liste). Klasör / etiket sayfasında "Swipe file: N kayıt →" linki. `#/thumb-test` (**Thumbnail testi**): bırak / seç, başlık (70 karakter uyarısı), kanal, izlenme, saat, süre; rakipler takip edilen nişin (yoksa klasörün ya da bütün kayıtlı kanalların) Library'deki videolarından (kanal başına en çok 3, güçlü ve yeni olanlar önce, karıştır); Ana sayfa / Arama, Masaüstü / Telefon, Açık / Koyu; senin videon ilk sırada ya da rastgele, isteğe bağlı çerçeve. Görsel `sessionStorage`'da (sekmede kalır). Niş Takibi'ne **Kim neyi tanıtıyor** kartı. Kenar çubuğunda iki yeni öğe (özellik kapalıysa gizli; swipe file kayıt varken görünür kalır). Geri yükleme `swipe`'ı birleştirir; `load()` artık `org.swipe`'ı da tutar (önceden bilinmeyen anahtarlar `saveOrg`'da düşüyordu).
- **Bridge (`mcp/content.mjs`, `bridge.mjs` → `content-tools` özelliği).** `POST /youtube/comments` (`comment-tools` kapalıysa `{ ok: false, off: true }`), `GET /youtube/sponsors?channel=` (kanal kartı), `/youtube/niche/page` cevabında `sponsors` (`channel-sponsors` açıksa), `/youtube/video-card` cevabında `history` (`cards.titleHistory`). Yorumlar `video_comments` + `comment_sets`'te, her yazma ve okumada 7 günden eskiler silinir. Tracker açıklamaları artık `tracked_videos.description`'a yazıyor (`videos.list` ve backfill); RSS işi 30 günden genç videoların thumbnail'ini hash'lerken görselin kendisini de (≤ 90 KB, data URL) `video_meta_log.thumb_snap`'e koyuyor, böylece değişiklikte önceki görsel görünür.
- **MCP.** `get_comments` (önce yakalananlar; yetmezse ya da `refresh` ile bridge anahtarıyla `commentThreads.list`, 100 yorum = 1 birim, ortak sayaca yazılır, günlük 9.000 bütçesi aşılmaz; yorumlar kapalıysa `disabled`; anahtar ve yakalanan yoksa `no_comments` ve ne yapılacağı), `sponsor_mentions` (niş, kanal, gün). Sunucu talimatlarına içerik araçları satırı eklendi. README tablosunda.
- **Migration 4 (`store.mjs`).** `video_comments`, `comment_sets`; `tracked_videos.description`, `tracked_videos.thumb_snap`, `video_meta_log.thumb_snap`.
- **Özellikler.** `available: true`: `transcript-tools`, `comment-tools`, `frame-capture`, `swipe-save`, `channel-sponsors`, `thumb-compress`, `thumb-preview` (`title-history` zaten hazırdı; izleme sayfası tarafı bu fazda). Açıklamalar güncellendi. Kalan "Yakında": `channel-similar`, `niche-radar` (faz 5) ve `channel-rpm`.
- **Testler.** `tests/content-tools.test.js` (8: panelin iki DOM düzeni fikstürden küçük bir sahte DOM ile (`tests/helpers/fake-dom.js`), json3 / XML / `captionTracks` / `pickTrack`, dışa aktarıcılar ve istem, iki yorum biçimi + sayılar + birleştirme, filtreler (TR/EN soru, küfür doğru / yanlış pozitif, ifade, sıralama), CSV formül koruması ve JSON, sıkıştırma planı), `tests/sponsors.test.js` (3: 13 fikstür açıklama, 8 doğru 5 yanlış pozitif; tür / kod / indirim sahipliği; nişte toplama), `tests/swipe.test.js` (5), `tests/content.test.mjs` (6: migration 4, yakalanan yorumlar ve 7 gün silme, `get_comments` yakalanan + filtreler, Data API sayfalama + kota + bütçe + kapalı yorumlar, `sponsor_mentions` niş / kanal / gün + kanal kartı, başlık geçmişi öncesi / sonrası VPH ve görseller), `tests/niche.test.mjs`'e thumbnail görüntüsü, `tests/mcp.test.mjs`'e uçtan uca (iki rota, özellik kapalıyken red, niş sayfasında `sponsors`, iki araç), `tests/features.test.js` güncel. Fikstürler `dev/youtube/content/` (`node dev/make-content-fixture.mjs`). `npm test`: **317/317** (faz 3: 294).
- **Demo.** `youtube-demo.html?surface=watch|shorts|channel`: oynayan bir video (canvas stream, kare yakalanabilir), YouTube'un "Transkripti göster" düğmesi ve paneli, `/next` ile gelen yorumlar, timedtext; `?transcript=new|cc|none`, `?comments=old|none`, `?taint` (başka origin'den video: tainted canvas), `?history=none`, `?sponsors=none`. `studio-demo.html` (Studio'nun Ayrıntılar sayfası ve kendi 2 MB kontrolü; `?hl=tr`, `?dark`, `?off=thumb-compress`). `dashboard-demo.html#/swipe` (`?swipe=empty`), `#/thumb-test` (niş kanallarının videolarına gerçekçi başlık ve yerel SVG thumbnail'ler), `#/niche` (`?sponsors=empty`). Demo sayfalarında blob indirmeleri kaydedilir, diske yazılmaz.
- **Ekran görüntüleri** (`docs/screenshots/phase4-*.png`, 30): `watch-transcript-en-light`, `watch-transcript-tr-dark` (yeni düzen), `watch-comments-questions-en-light`, `watch-comments-tr-dark` (küfür gizli + beğeniye göre), `watch-save-en-light`, `watch-saved-en-light`, `watch-frame-en-light`, `watch-frame-tainted-en-dark`, `watch-medium-tr-light` (1024), `watch-narrow-comments-en-light` ve `watch-narrow-save-tr-dark` (390), `shorts-comments-en-dark`, `shorts-save-tr-light`, `channel-sponsors-en-light`, `channel-sponsors-tr-dark`, `studio-compress-prompt-tr-dark`, `studio-compress-done-en-light`, `studio-handed-en-light`, `library-swipe-en-light`, `library-swipe-edit-tr-dark`, `library-swipe-narrow-en-light`, `library-swipe-empty-en-light`, `library-thumb-test-home-en-light`, `library-thumb-test-search-dark-en`, `library-thumb-test-phone-dark-en`, `library-thumb-test-narrow-tr-dark`, `library-thumb-test-empty-tr-light`, `library-niche-sponsors-en-light`, `library-niche-sponsors-narrow-tr-dark`, `library-settings-features-en-light`. Canlı kapatma denendi: her anahtar kendi parçasını (çip, kamera, geçmiş satırı, Studio diyaloğu ve linki) yenilemeden kaldırıyor ve geri getiriyor.

### Plandan sapmalar

- **Sponsor taraması API anahtarı istemiyor**, bridge istiyor: açıklamalar tracker'ın `videos.list` okumalarından ve Library'den geliyor (`requires: ['bridge']`, `optional: ['tracker']`). Kayıt tablosu yok; tarama her istekte yapılıyor (yüzlerce açıklama için milisaniyeler).
- **Başlık geçmişinde thumbnail görselleri yalnız 30 günden genç videolarda** (ve bu fazdan sonraki değişikliklerde) var: YouTube aynı adreste yeni görsel sunduğu için önceki görsel ancak saklanırsa gösterilebiliyor. Eski videolarda satır "yeni görsel" der. Görseller ≤ 90 KB data URL olarak SQLite'ta.
- **Yorumlar iki yerde, iki süre:** tarayıcıda 3 gün (panel yeniden açılınca hazır olsun diye), bridge'de 7 gün (`get_comments`). Bridge'de özellik kapalıysa hiç yazılmaz.
- **Transcript'in son yedeği bir YouTube isteği** (sayfanın listelediği altyazı kanalı, sekmenin kendi oturumuyla, yalnız transcript açılınca). README → Privacy'de yazıyor. YouTube bu isteği `pot` belirteci olmadan boş döndürebiliyor; o durumda "transcript yok" denir, CC açıldıktan sonra oynatıcının kendi yüklediği altyazı kullanılır.
- **Swipe file kaydı izleme sayfasında çip, Shorts'ta araç çubuğu düğmesi**; kare yakalama her ikisinde araç çubuğunda (görev "araç çubuğuna küçük bir düğme" diyor). İzleme sayfasında araç çubuğuna ayrıca kaydet düğmesi konmadı (iki yerde aynı şey kalabalık olurdu).
- **Thumbnail testi Library'de**; Studio'dan link var, Studio içinde ayrı bir önizleme yok. Görsel kalıcı saklanmaz (sekme oturumu).
- **Swipe file'daki klasörler Library'nin hesap klasörleriyle aynı liste**; yalnız swipe kaydı olan bir klasör kenar çubuğunda "0" hesapla görünür, sayfası swipe kayıtlarına link verir.
- **Yorum sayısı dilini** veri içindeki kelimelerden (`görüntüleme`, `yorum`) ya da `<html lang>`'dan alıyor (faz 3'ün `dataLang` mantığı).
- **Faz 3 düzeltmesi:** izleme kartı, hemen altındaki araç satırını "yerinde değil" sayıp kendini yeniden yerleştiriyordu; dar ekranda ikisi yer değiştiriyordu. Kart artık arkasındaki araç satırını yok sayıyor.

### Faz 5 için bilinmesi gerekenler

- Sonraki migration **5**.
- `video_comments` 7 günlük; uzun süreli yorum analizi gerekirse ayrı bir özet tablosu düşünülmeli (metin değil, sayılar).
- `tracked_videos.description` artık dolu (yeni ölçümlerden itibaren; eski kayıtlar bir sonraki `videos.list` okumasıyla dolar). Anahtar kelime fikirleri ve TF-IDF benzerliği (6.4, 6.6) bunu kullanabilir; `src/sponsors.js`'in `fold` / host yardımcıları da.
- `overlay.addButton({ id, icon, title, visible, pressed, onClick })` araç çubuğuna düğme eklemenin yolu; popover için `youtube-tools.js` → `openPop` düzeni.
- Benzer kanallar için "Up Next" listeleri: hook `/next` yanıtlarının hepsini zaten iletiyor; `parseCards` yan listeyi okuyor.
- Kurulum: birleştirdikten sonra eklentiyi yeniden yükle (Studio için yeni içerik betiği) ve bridge'i yeniden başlat (`launchctl kickstart -k gui/$(id -u)/dev.openoutlier.bridge`; migration 4 ve `content-tools` rotaları).

### Açık konular

- **Gerçek youtube.com ve studio.youtube.com'da denenmedi.** Bakılacaklar: transcript düğmesinin seçicisi (`ytd-video-description-transcript-section-renderer button`; yoksa aria-label "Show transcript" / "Transkripti göster"), panelin kapatma düğmesi, yorum entity'lerinin alan adları (`likeCountNotliked`, `replyCount`, `heartState`), Studio'nun dosya alanının açık shadow root'ta mı olduğu ve `change` olayını nerede dinlediği (biz capture aşamasında belge ve açık shadow root'larda yakalıyoruz; kapalı shadow root'ta yakalanamaz, o zaman Studio kendi "çok büyük" uyarısını gösterir).
- YouTube'un timedtext isteği `pot` isteyebilir; panel ve CC yolları bundan etkilenmez.
- Dar ekranda (390 px) faz 3'ün satır içi araç çubuğu (izleme sayfası, beğen satırında) sayfa kaydırılınca sabit konumlu kartıyla birlikte üst çubuğun üstüne çıkabiliyor; faz 3'ten gelen davranış, bu fazda değiştirilmedi.
- Küfür listeleri kısa ve elle yazılmış; yanlış negatifler olacaktır (özellikle argo varyantlar). Liste `CT.PROFANITY`'de.
- Swipe file `rs:org` içinde olduğu için her değişiklikte bütün org bridge'e gidiyor; birkaç yüz kayıtta sorun değil, binlerce kayıtta ayrı bir anahtar düşünülebilir.
