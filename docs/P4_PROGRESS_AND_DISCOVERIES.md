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

## Sıradaki kontrollü işler

1. P2F: disposable PostgreSQL üzerinde tutarlılık sözleşmesi kanıtı.
2. Gerekirse eksik writer/lifecycle closure.
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
