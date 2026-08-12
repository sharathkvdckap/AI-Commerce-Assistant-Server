<?php

declare(strict_types=1);

namespace Klizer\AiCommerceConversion\Model;

use Magento\Framework\Stdlib\Cookie\CookieMetadataFactory;
use Magento\Framework\Stdlib\CookieManagerInterface;
use Magento\Framework\Session\SessionManagerInterface;

class AttributionCookie
{
    public const COOKIE_NAME = 'ai_commerce_attr';
    private const MAX_ITEMS = 20;
    private const TTL_SECONDS = 604800;

    public function __construct(
        private readonly CookieManagerInterface $cookieManager,
        private readonly CookieMetadataFactory $cookieMetadataFactory,
        private readonly SessionManagerInterface $sessionManager
    ) {
    }

    /**
     * @return array{
     *   userId?: string,
     *   sessionId?: string,
     *   items?: list<array<string, string>>
     * }
     */
    public function read(): array
    {
        $raw = (string) $this->cookieManager->getCookie(self::COOKIE_NAME, '');
        if ($raw === '') {
            return [];
        }
        try {
            $decoded = json_decode(rawurldecode($raw), true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return [];
        }
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Merge a PDP click (query params from the assistant View Product link).
     *
     * @param array<string, string> $hit
     */
    public function capture(array $hit): void
    {
        $sku = trim((string) ($hit['sku'] ?? ''));
        $searchId = trim((string) ($hit['searchId'] ?? ''));
        if ($sku === '' || $searchId === '') {
            return;
        }

        $data = $this->read();
        $userId = trim((string) ($hit['userId'] ?? ''));
        if ($userId !== '') {
            $data['userId'] = $userId;
        }
        $sessionId = trim((string) ($hit['sessionId'] ?? ''));
        if ($sessionId !== '') {
            $data['sessionId'] = $sessionId;
        }

        $item = [
            'sku' => $sku,
            'searchId' => $searchId,
            'source' => trim((string) ($hit['source'] ?? '')),
            'productId' => trim((string) ($hit['productId'] ?? '')),
            'productName' => trim((string) ($hit['productName'] ?? '')),
        ];

        $items = is_array($data['items'] ?? null) ? $data['items'] : [];
        $items = array_values(array_filter(
            $items,
            static fn ($row) => is_array($row) && strcasecmp((string) ($row['sku'] ?? ''), $sku) !== 0
        ));
        array_unshift($items, $item);
        $data['items'] = array_slice($items, 0, self::MAX_ITEMS);

        $metadata = $this->cookieMetadataFactory->createPublicCookieMetadata()
            ->setDuration(self::TTL_SECONDS)
            ->setPath($this->sessionManager->getCookiePath() ?: '/')
            ->setHttpOnly(true)
            ->setSameSite('Lax');
        $domain = $this->sessionManager->getCookieDomain();
        if ($domain) {
            $metadata->setDomain($domain);
        }

        $this->cookieManager->setPublicCookie(
            self::COOKIE_NAME,
            rawurlencode(json_encode($data, JSON_UNESCAPED_SLASHES) ?: '{}'),
            $metadata
        );
    }

    /**
     * @param list<string> $skus
     * @return list<array<string, string>>
     */
    public function matchItems(array $skus): array
    {
        $wanted = [];
        foreach ($skus as $sku) {
            $key = strtolower(trim($sku));
            if ($key !== '') {
                $wanted[$key] = true;
            }
        }
        if ($wanted === []) {
            return [];
        }

        $matched = [];
        foreach ($this->read()['items'] ?? [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $sku = strtolower(trim((string) ($item['sku'] ?? '')));
            if ($sku !== '' && isset($wanted[$sku])) {
                $matched[] = $item;
            }
        }
        return $matched;
    }
}
