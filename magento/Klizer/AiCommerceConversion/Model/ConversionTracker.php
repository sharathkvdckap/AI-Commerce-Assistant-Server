<?php

declare(strict_types=1);

namespace Klizer\AiCommerceConversion\Model;

use Magento\Quote\Model\Quote;
use Magento\Quote\Model\Quote\Item as QuoteItem;
use Magento\Sales\Model\Order;
use Magento\Sales\Model\Order\Item as OrderItem;

class ConversionTracker
{
    public function __construct(
        private readonly Config $config,
        private readonly AttributionCookie $cookie,
        private readonly EventClient $client
    ) {
    }

    public function trackCart(Quote $quote): bool
    {
        return $this->trackQuote($quote, 'cart');
    }

    public function trackCheckout(Quote $quote): bool
    {
        return $this->trackQuote($quote, 'checkout');
    }

    private function trackQuote(Quote $quote, string $eventType): bool
    {
        if (!$this->config->isEnabled()) {
            return false;
        }
        $attr = $this->cookie->read();
        $matched = $this->matchQuoteItems($quote);
        if ($matched === []) {
            return false;
        }

        $events = [];
        foreach ($matched as $row) {
            $searchId = (string) ($row['attr']['searchId'] ?? '');
            if (!$this->client->isUuid($searchId)) {
                continue;
            }
            $item = $row['item'];
            $events[] = [
                'eventType' => $eventType,
                'sku' => (string) $row['attr']['sku'],
                'searchId' => $searchId,
                'sessionId' => $this->uuidOrNull((string) ($attr['sessionId'] ?? '')),
                'source' => (string) ($row['attr']['source'] ?? '') ?: null,
                'productId' => (string) ($row['attr']['productId'] ?? '') ?: (string) $item->getProductId(),
                'productName' => (string) ($row['attr']['productName'] ?? '') ?: (string) $item->getName(),
                'quoteId' => (string) $quote->getId(),
                'qty' => (float) $item->getQty(),
                'revenue' => (float) $item->getRowTotalInclTax(),
                'currency' => (string) $quote->getQuoteCurrencyCode(),
            ];
        }

        $this->client->post(
            (string) ($attr['userId'] ?? ''),
            $this->stripNulls($events),
            (string) ($attr['sessionId'] ?? '')
        );
        return $events !== [];
    }

    public function trackOrder(Order $order): void
    {
        if (!$this->config->isEnabled()) {
            return;
        }
        $attr = $this->cookie->read();
        $matched = $this->matchOrderItems($order);
        if ($matched === []) {
            return;
        }

        $events = [];
        foreach ($matched as $row) {
            $searchId = (string) ($row['attr']['searchId'] ?? '');
            if (!$this->client->isUuid($searchId)) {
                continue;
            }
            $item = $row['item'];
            $events[] = [
                'eventType' => 'order',
                'sku' => (string) $row['attr']['sku'],
                'searchId' => $searchId,
                'sessionId' => $this->uuidOrNull((string) ($attr['sessionId'] ?? '')),
                'source' => (string) ($row['attr']['source'] ?? '') ?: null,
                'productId' => (string) ($row['attr']['productId'] ?? '') ?: (string) $item->getProductId(),
                'productName' => (string) ($row['attr']['productName'] ?? '') ?: (string) $item->getName(),
                'quoteId' => (string) $order->getQuoteId(),
                'orderId' => (string) $order->getIncrementId(),
                'qty' => (float) $item->getQtyOrdered(),
                'revenue' => (float) $item->getRowTotalInclTax(),
                'currency' => (string) $order->getOrderCurrencyCode(),
                'meta' => [
                    'entityId' => (int) $order->getEntityId(),
                ],
            ];
        }

        $this->client->post(
            (string) ($attr['userId'] ?? ''),
            $this->stripNulls($events),
            (string) ($attr['sessionId'] ?? '')
        );
    }

    /**
     * @return list<array{attr: array<string, string>, item: QuoteItem}>
     */
    private function matchQuoteItems(Quote $quote): array
    {
        $out = [];
        foreach ($quote->getAllVisibleItems() as $item) {
            $attr = $this->firstMatch($this->itemSkus($item));
            if ($attr !== null) {
                $out[] = ['attr' => $attr, 'item' => $item];
            }
        }
        return $out;
    }

    /**
     * @return list<array{attr: array<string, string>, item: OrderItem}>
     */
    private function matchOrderItems(Order $order): array
    {
        $out = [];
        foreach ($order->getAllVisibleItems() as $item) {
            $attr = $this->firstMatch($this->itemSkus($item));
            if ($attr !== null) {
                $out[] = ['attr' => $attr, 'item' => $item];
            }
        }
        return $out;
    }

    /**
     * @param list<string> $skus
     * @return array<string, string>|null
     */
    private function firstMatch(array $skus): ?array
    {
        $matched = $this->cookie->matchItems($skus);
        return $matched[0] ?? null;
    }

    /**
     * @param QuoteItem|OrderItem $item
     * @return list<string>
     */
    private function itemSkus(object $item): array
    {
        $skus = [
            (string) $item->getSku(),
        ];
        $product = method_exists($item, 'getProduct') ? $item->getProduct() : null;
        if ($product && $product->getSku()) {
            $skus[] = (string) $product->getSku();
        }
        if (method_exists($item, 'getParentItem') && $item->getParentItem()) {
            $skus[] = (string) $item->getParentItem()->getSku();
        }
        return array_values(array_unique(array_filter($skus)));
    }

    private function uuidOrNull(string $value): ?string
    {
        return $this->client->isUuid($value) ? $value : null;
    }

    /**
     * @param list<array<string, mixed>> $events
     * @return list<array<string, mixed>>
     */
    private function stripNulls(array $events): array
    {
        return array_map(static function (array $event): array {
            return array_filter(
                $event,
                static fn ($value) => $value !== null && $value !== ''
            );
        }, $events);
    }
}
