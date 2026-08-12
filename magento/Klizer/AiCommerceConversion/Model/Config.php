<?php

declare(strict_types=1);

namespace Klizer\AiCommerceConversion\Model;

use Magento\Framework\App\Config\ScopeConfigInterface;
use Magento\Store\Model\ScopeInterface;

class Config
{
    private const XML_ENABLED = 'klizer_aiconversion/general/enabled';
    private const XML_API_BASE = 'klizer_aiconversion/general/api_base_url';
    private const XML_TOKEN = 'klizer_aiconversion/general/ingest_token';

    public function __construct(private readonly ScopeConfigInterface $scopeConfig)
    {
    }

    public function isEnabled(?int $storeId = null): bool
    {
        return $this->scopeConfig->isSetFlag(
            self::XML_ENABLED,
            ScopeInterface::SCOPE_STORE,
            $storeId
        );
    }

    public function getApiBaseUrl(?int $storeId = null): string
    {
        return rtrim((string) $this->scopeConfig->getValue(
            self::XML_API_BASE,
            ScopeInterface::SCOPE_STORE,
            $storeId
        ), '/');
    }

    public function getIngestToken(?int $storeId = null): string
    {
        return trim((string) $this->scopeConfig->getValue(
            self::XML_TOKEN,
            ScopeInterface::SCOPE_STORE,
            $storeId
        ));
    }
}
