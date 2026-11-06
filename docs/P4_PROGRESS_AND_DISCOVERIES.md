# Package 4 — ilerleme ve Finance arama keşifleri

**Kanıt revizyonu:** `a842d9edb371465c3f6010608fbe27c32f9326ee` (`main`, 2026-11-06 doğrulandı). Bu kayıt ürün uygulaması veya yeni finans kuralı değildir. Deney sonuçları kalıcı üretim özelliği sayılmaz. `UNKNOWN`, eldeki kanıtın yeterli olmadığını belirtir.

## Mimari ve yetki sınırı

Ön yüz React, TypeScript ve Vite; arka uç Fastify, Prisma ve PostgreSQL kullanır (`package.json`, `backend/package.json`, `backend/prisma/schema.prisma`). Shopify Admin GraphQL harici ticaret gerçeğidir; webhook bir olay zarfıdır. Shopify erişimi arka uçta kalır. Yerel operasyonel gerçek; Vendor allocation, iade, fulfillment, uzlaştırma ve finans kanıtıdır. Ayrıntılar: [Shopify keşifleri](SHOPIFY_DISCOVERIES.md), [arka uç mimarisi](BACKEND_ARCHITECTURE.md), [API sözleşmeleri](API_CONTRACTS.md).

Admin seçilmiş Vendor bağlamını doğruladıktan sonra Vendor Workspace okur; Admin'in o Vendor üyeliği gerekmez. Vendor kullanıcısının üyelik ve allocation sahipliği sınırları devam eder. Orders, Returns ve Finance kendi kayıt/servis yetkilerini korur. Finans ekranındaki etiket, `FinanceLedgerEntry` veya onaylı `SettlementApprovalLine` parasal otoritesi değildir. [Package 3 kapanışı](PACKAGE_3_CLOSURE.md) bu önceki kapsamı `PACKAGE_3_CLOSED_WITH_DOCUMENTED_VERIFICATION_LIMITATIONS` olarak kaydeder; Package 4 onu yeniden açmaz.

## Package 4 ilerlemesi

| İş | Durum ve kaynak | Doğrulama sınırı |
| --- | --- | --- |
| P4-06A Orders | [PR #41](https://github.com/onurdpl/1vendor-dashboard/pull/41) merge `ea0f11f451af61e552a064bae344173acfba3dc8`. `orders.service.ts:listVendorOrders`, `orders.routes.ts`, `OrdersPage.tsx`: sunucu araması, offset/limit sayfalama, istemcide sonraki sayfa kontrolü. | Kaynak ve PR merge doğrulandı; bu belgede testler yeniden çalıştırılmadı. Arama ve sayfalama tüm olası iş akışı filtreleri için ayrı kanıt gerektirir. |
| P4-06B Returns | [PR #42](https://github.com/onurdpl/1vendor-dashboard/pull/42) merge `3d82aa3ca51b7653f87ae6bd52f438992d3b772f`. `returns.service.ts:listVendorReturns`, `ReturnsPage.tsx`: sunucu araması, offset/limit sayfalama. `src/returns-pagination-search.postgres.test.ts` vardır. | Kaynak/merge doğrulandı; bu belgede testler yeniden çalıştırılmadı. |
| P4-06C Finance | **Sürüyor.** P1 [PR #43](https://github.com/onurdpl/1vendor-dashboard/pull/43) merge `a842d9edb371465c3f6010608fbe27c32f9326ee`; [CI düzeltmesi PR #44](https://github.com/onurdpl/1vendor-dashboard/pull/44) merge `190afd428e860b9e6ec90aed4a227082d6efc914`. `src/lib/financePresentation.ts` çıkarıldı. 104/104 odaklı test ve post-merge CI #1561 PASS önceki raporlarda bildirildi; ham yerel test çıktısı burada tekrar üretilmedi. | **Tüm geçmişte Finance araması ve 100'lük sayfalama üretimde yoktur.** `FinancePage.tsx` halen yüklenen kayıtları filtreler. |
| P4-07 Support isolation | Önceki proje raporuna göre başlamadı. | Bu adla onaylı uygulama/kapama belgesi saptanmadı; kapsam ve güncel durum `UNKNOWN`. |
| P4-08 son doğrulama/kapanış | Önceki proje raporuna göre başlamadı. | Resmi kapanış kanıtı saptanmadı; güncel durum `UNKNOWN`. |

Diğer Package 4 işleri için bu belge yeni tamamlanma iddiası kurmaz. GitHub PR merge, testin bu görevde yeniden çalıştırıldığı anlamına gelmez.

## P4-06C araştırma zinciri

| Aşama | Bildirilen sonuç | Deneyle sınırlı bulgu |
| --- | --- | --- |
| P1 | MERGED | Mevcut Admin/Vendor sunumu karakterize edilip `financePresentation.ts` içine çıkarıldı. |
| P2A | MORE_EVIDENCE_REQUIRED | Kısmi SQL eşleme 54 karşılaştırmanın 14'ünü kaçırdı. |
| P2B | PARITY_FAILED | Statik fixture üzerinde kanonik eşleme; offset devamı başarısız; 10 bin no-match 49.776 s. |
| P2C | MORE_EVIDENCE_REQUIRED | Kanıtları toplu yükleme: 10 binde 3.22 s, 100 binde 35.71 s; keyset devamı gösterildi. |
| P2D | MORE_EVIDENCE_REQUIRED | İndeksli kanonik projeksiyon statikte 92/92 eşleme ve 100 bin satırda yaklaşık 0.08 ms PostgreSQL no-match sorgusu; kurulum yaklaşık 43.40 s/21,003 SQL sorgusu. Ölçüm kurulum/yenileme maliyetini içermez. Zamanla değişen statü ve yenilenmeyen void kayıt bayat kalabilir. |
| P2E | MORE_EVIDENCE_REQUIRED | Gerçek Settlement DRAFT/APPROVED ve Payout DRAFT/REVIEW/PAID yazıcıları, ledger satırını değiştirmeden aranabilir durumu değiştirdi. Ayrı commit edilmiş yenileme hatası false negative üretti; eski yenileme bayat metni geri koyabildi. |
| P2F | **PARTIAL_CONSISTENCY_PROVEN** (2026-11-06, yalnız disposable deney) | Gerçek Settlement/Payout servisleriyle sınırlı trigger-journal, rollback ve sürüm-fenced refresh çalıştı. Eksik projeksiyon kaydı journal boşken saptanamadı; bütün yazıcılar kapsanmadı. Üretim arama sözleşmesi hazır değil. |

P2E deneyinde kanonik kanıttan İngilizce ve Vendor Türkçe etiketleri hesaplandı. Canlı sahiplik/aktif-ledger join'i bazı false positive'leri engelledi; eksik veya yanlış indekslenmiş eşleşmeyi geri getirmedi. Settlement delay eşiği ledger yazısı olmadan aşıldı; tek zaman fixture'ında sınır-tabanlı sorgu geçti. Refund kanıtının tam ilişkilendirilmesi kısmen doğrulandı. Tüm yazıcı/yaşam döngüsü kapanışı ve üretime güvenli indeksli arama **kanıtlanmadı**. Bunlar geçici yerel PostgreSQL deneyleridir, üretim hatası iddiası değildir.

## Finans etiketleri ve otorite

`src/lib/financeOperationalProjection.ts:getLegacyStatusLabel` Admin'in ve mevcut aramanın İngilizce operasyonel etiketini, `src/lib/financePresentation.ts:getVendorFinanceScenario` Vendor'ın Türkçe satır etiketini belirler. Öncelik tek bir `Estimated → Pending review → Paid` hattı değildir: refund offset, Vendor hold/blocked, failed/disputed, refund impact, payout batch, settlement review ve readiness ayrı dallardır. Örnek İngilizce etiketler `Estimated`, `Pending review`, `Settlement draft locked`, `Settlement approved`, `Approved`, `Scheduled`, `Blocked`, `On hold`, `Refund impact`, `Paid`, `Completed by verified offsets (no EFT)`; Vendor durumları `Hesaplanıyor`, `İncelemede`, `Hazır`, `Beklemede`, `Askıda`, `Ödendi` (aynı kaynak fonksiyonlar).

`SettlementApproval` DRAFT/APPROVED inceleme kanıtı, `PayoutBatch` DRAFT/REVIEW/APPROVED/PAID ödeme hazırlığı/kanıtı ve `Mark Paid` birbirine eşit değildir. Cashless completion doğrulanmış mahsuplaşmayı gösterir, EFT ödendi kanıtı değildir (`getPayoutBatchStatusLabel`). Vendor `Ödendi` için `hasReliablePaidEvidence` paid payout status, settled settlement ve ödeme tarihi ister. Onaylı `SettlementApprovalLine.payableImpactMinor` payout parasal temelidir; ekran etiketi parasal değeri yeniden hesaplamaz ([Finance Settlement Model](FINANCE_SETTLEMENT_MODEL.md), [Admin Finance Architecture](product/ADMIN_FINANCE_ARCHITECTURE.md)). Ödenmiş kayıtların terminal finansal kuralları korunmalıdır.

## Mevcut arama sözleşmesi ve onaylı hedef

`src/lib/financePresentation.ts:getFinanceSearchableText` aşağıdaki alanları **bu sırada tek boşlukla birleştirip küçük harfe** çevirir: ledger ID, description, category, İngilizce operational status, formatlanmış amount, counterparty, Vendor name, Vendor ID, Shopify order number, Shopify order ID, Shopify refund ID. `FinancePage.tsx` dış boşluğu kırpıp `includes` ile substring arar. Bu nedenle alan sınırından geçen eşleşme de mümkündür; ayrı SQL `OR` alan karşılaştırması eşdeğer değildir. `record.amount` mevcut `Intl` biçimlendirmesini ve gerektiğinde Unicode nonbreaking space'i taşır (`src/services/real/formatting.ts`). Gösterimde Refund/Adjustment önüne gelen eksi işareti arama metnindeki `record.amount` değerine otomatik eklenmez. Arama şu anda yalnız yüklü ilk işlem kümesini kapsar. Vendor Türkçe görünen etiketleri mevcut İngilizce metne dahil değildir; hedef sözleşmeye **eklenmesi onaylandı**, ancak henüz uygulanmadı. `1500` gibi yeni sayısal alias/normalizasyon **onaylanmadı**.

**Kullanıcı kararı: Option A, live keyset pagination.** Hedef 100 sonuç/sayfa; sıralama `(createdAt DESC, id DESC)`, Vendor'a bağlı cursor, sayfalamadan önce arama ve güncel finans kanıtı. Yeni insert konumsal offset kayması yaratmamalı. Durum değiştikçe sayfalar arası üyelik değişebilir; katı frozen snapshot istenmiyor. En güncel tam sonuç için aramayı yeniden başlatmak gerekir. Bu karar, finans otoritesini değiştirmez.

## Sorun kaydı

| Durum | Konu ve kanıt | Sonraki kontrol |
| --- | --- | --- |
| FAIL (deney) | P2E ayrı commit refresh hatası yanlış negatif; out-of-order refresh bayat metin. | P2F atomiklik/sürüm/fail-closed kanıtı. |
| FAIL (deney) | Time-only eligibility ve eksik projeksiyon canlı join ile telafi edilmedi. | P2F tam sınır ve completeness. |
| PASS (sınırlı deney) | Canlı ledger owner ve active/void join'i yanlış Vendor/void false positive'lerini engelledi. | False negative ve successor kapsamı. |
| RISK | Yazıcı→ledger invalidation haritası kapanmadı: settlement, payout, refund adjustment lifecycle, komisyon faturası, shipping/hold/cancellation, Vendor ad değişikliği ve ekonomik transfer. | Tek tek writer/transaction sınırı araştırması. |
| RISK | Superseded/void görünürlük, transfer, delayed refresh, eş zamanlı güncelleme. | P2F iki Vendor/ardıl ledger deneyi. |
| UNKNOWN | Üretim cursor yetkisi; tarihsel deep-link exact ledger lookup ve çoklu order/refund eşleşmesi; Overview'un sayfalı işlemden bağımsızlığı. | Kısıtlı API/UI tasarım ve yetki testleri. |
| UNKNOWN | Gerçek üretim veri boyutu, arama latency hedefi, concurrency performansı, kalıcı projection tablosunun gerekliliği. | Onaylı izole ölçüm/karar; üretim DB'sine bu görevde erişim yok. |

`PASS` bir deney kapsamı dışına taşınmaz. `FAIL` burada üretim kusuru anlamına gelmez. `RISK` ve `UNKNOWN` doğrulanmış hata değildir.

## P2F — disposable tutarlılık kanıtı

**Sonuç:** `P4_06C_P2F_PARTIAL_CONSISTENCY_PROVEN`. Bu, üretim projection/index kararı değildir. Temel `main` `0e64049e` yalnız bu belgenin ilk sürümünü ekledi; uygulama kodu Finance P1 revizyonu `a842d9e` idi. Yerel PostgreSQL 18.3 `127.0.0.1:55439`, rol `sporgym_p2a`, yeni `sporgym_p2f_disposable_20261106` veritabanı kullanıldı. Önceki P2E disposable veritabanından sentetik fixture'lar kopyalandı; veritabanı başlangıcı boş değildi. 251,432 ledger ve 211,007 statik arama satırı (415 MB veritabanı) vardı. Üretim verisi veya performans ölçümü değildir.

Gerçek `createAdminManualDraftApproval`, `approveSettlementApproval`, `preparePayoutBatch`, `markPayoutBatchReview`, `markPayoutBatchPaid` servisleri yeni sentetik Vendor/allocation/ledger fixture'ında çalıştırıldı (`backend/src/modules/finance/settlement-approval.service.ts`, `finance.service.ts`). DRAFT ve APPROVED ile Payout DRAFT/REVIEW/PAID aşamalarının her biri kanonik sunumu değiştirdi; depolanmış eski arama metni her aşamada güncel olmadı. Bu işlemler kendi Prisma transaction'larını açar; dışarıdaki bir refresh'i aynı mevcut servis transaction'ına sokmak **kanıtlanmadı**. Geçici **yalnız disposable DB** trigger'ları `SettlementApprovalLine`, `SettlementApproval.status`, `PayoutBatchLine`, `PayoutBatch.status` ve `FinanceLedgerEntry` için aynı commit içinde `ledger_id,revision` dirty satırı yazdı. Test fixture'ında DRAFT sonrası revision 2, tüm real workflow sonrasında revision 7 görüldü. Bu, **yalnız listelenen olaylar** için commit ile marker atomikliğini gösterir; bütün finans yazıcılarını kapsamaz.

| Sonuç | Deney ve sınır |
| --- | --- |
| PASS — sınırlı | Kirli ledger için sorgu `SEARCH_UNAVAILABLE` benzeri açık hata vermek üzere reddedilebilir; refresh ile marker temizleme aynı ayrı transaction'da yapıldı. Commit öncesi enjekte edilen hata hem source hem marker'ı geri aldı. Commit sonrası source değişimi marker bıraktı; ayrı refresh hatası marker'ı korudu. Bu uygulama davranışı değil, geçici prototip sözleşmesidir. |
| PASS — sınırlı | `revision` koşullu UPSERT eski refresh'in yeni metni ezmesini önledi; duplicate refresh idempotent sınıra uygundur. Eşzamanlı gerçek writer/worker yarışlarının tam interleaving matrisi **UNKNOWN**. |
| PASS — sınırlı | Kanonik settlement-delay fixture'ında eşikten **1 ms önce / tam eşikte / 1 ms sonra** sırasıyla Admin `Estimated / Pending review / Pending review`, Vendor `Hesaplanıyor / Hazır / Hazır`; iki alternatif tam birleşik metin query-time sınırla eşleşti, ledger `updatedAt` değişmedi. Başka finans olayının sınır dalını geçersiz kıldığı fixture **UNKNOWN**. |
| PASS/FAIL | Canlı `FinanceLedgerEntry.vendorId` + `voidedAt` join'i yanlış projected owner/void false positive'ini engelledi. Yanlış projected owner doğru Vendor için false negative bıraktı. Marker boşken projeksiyon satırı silinince aktif kanonik ledger eksik kaldı ve guard bunu **tespit edemedi**. Bu nedenle genel fail-closed ve completeness **FAIL**. |
| PASS — statik | 1,000 kanonik işlem, 10 sayfalı DTO okuması, 32/32 sıralı Admin/Vendor arama ID-set karşılaştırması; İngilizce/Türkçe etiket, NBSP, `%`, `_`, order/refund ve Vendor referansları dahil. Bu 211 bin satırın tamamı için parity kanıtı değildir. |
| PASS — live keyset fixture | 100+100 satır, 0 overlap; ilk sayfadan sonra yeni insert ikinci sayfayı değiştirmedi (0 ID farkı). İkinci sayfada void veya eşleşme üyeliği değişince 100 satır kaldı, 1 yer değiştiren ID görüldü. Bunlar rollback edilen sentetik işlemlerdir; katı snapshot iddiası değildir. Yeni successor ledger'ın gerçek ekonomik transfer servisiyle üretimi **UNKNOWN**. |

`EXPLAIN (ANALYZE, BUFFERS)` ile 1,000 projected satırlı Vendor'da `%zz-no-match%` sorgusunun PostgreSQL yürütme süresi **0.244 ms** (planlama 1.621 ms) ölçüldü; trigram ve Vendor/order indeksleri kullanıldı. Bu ölçüm refresh, HTTP, eşzamanlılık veya 100 binlik Vendor gecikmesini içermez. Tek Vitest consistency testinin 133 ms test süresi, tek refresh maliyeti değildir. Testler disposable fixture ile **9 ayrı tek-test Vitest çalıştırmasında PASS** (trigger öncesi 3 real workflow, trigger sonrası 3 real workflow, zaman, parity, consistency); ayrıca 2 SQL keyset deneyi PASS. Kod geçici olarak ayrı proje worktree'sine kopyalandı ve test sonrası kaldırıldı; kalıcı yeniden çalıştırılabilir test eklenmedi. Deney SQL/JSON dosyaları `/private/tmp/sporgym-p2f-20261106/` altında geçicidir, kalıcı kaynak bağlantısı değildir.

**Sınır ve sonraki iş:** Dirty journal'ın tüm dolaylı writer'ları (refund adjustment, komisyon faturası, shipping, hold/cancellation, Vendor adı, ekonomik transfer, ardıl ledger) işaretlediği gösterilmedi. Eksik/yanlış projeksiyon satırı için tamlık sertifikası veya güvenli tespit yok. Time-only sınırın bütün etiket öncelikleriyle geçerliliği de kanıtlanmadı. En küçük sonraki kontrollü görev: **read-only writer→ledger kapanışı ve completeness/fail-closed sözleşmesi tasarımı**; her writer için transaction ve invalidation haritası, başlangıç/backfill doğrulaması, eksik satır tespiti ve eşzamanlı refresh interleaving test planı çıkarılmalı. Üretim Finance arama API'si, migration veya scheduler bu kanıttan otomatik başlatılmamalı.

## Sıradaki kontrollü işler

1. P2F disposable PostgreSQL kanıtı: **kısmi tamamlandı**, yukarıdaki FAIL/UNKNOWN kayıtları açık.
2. Eksik writer/lifecycle closure ve completeness/fail-closed sözleşmesi.
3. Doğrudan sorgu, hibrit veya projection mimarisi kararı.
4. Sınırlı backend Finance tam-geçmiş arama.
5. Tarihsel ledger lookup.
6. Overview verisini işlem sayfalamasından ayırma.
7. Frontend Transactions arama ve 100'lük sayfalama.
8. Vendor A→B→A ve finans regresyon doğrulaması.
9. P4-07 Support isolation.
10. P4-08 son doğrulama ve kapanış.

Hiçbiri yalnız bu listede olduğu için tamamlanmış sayılmaz.

## HOW TO CONTINUE IN A NEW CHAT

Önce bu dosyayı, `AGENTS.md`, `docs/SHOPIFY_DISCOVERIES.md` ve ilgili Finance dokümanlarını oku. Güncel `origin/main`, PR ve CI durumunu doğrula. Kullanıcının live keyset/100 sonuç kararını koru. Birleştirilmiş kodu disposable deneyden ayır. Shopify veya finans kuralı uydurma; finansal otoriteyi ve Vendor izolasyonunu koru. Küçük, kontrollü Codex görevleri kullan ve son **kanıtlanmış** sonuçtan devam et. `UNKNOWN` maddeleri başarı diye kapatma.
