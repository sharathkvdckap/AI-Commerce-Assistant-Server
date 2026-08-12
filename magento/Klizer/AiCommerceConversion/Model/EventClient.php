<?php

declare(strict_types=1);

namespace Klizer\AiCommerceConversion\Model;

use Magento\Framework\HTTP\Client\Curl;
use Psr\Log\LoggerInterface;

class EventClient
{
    public function __construct(
        private readonly Config $config,
        private readonly Curl $curl,
        private readonly LoggerInterface $logger
    ) {
    }

    /**
     * @param list<array<string, mixed>> $events
     */
    public function post(string $userId, array $events, ?string $sessionId = null): bool
    {
        if ($events === []) {
            return false;
        }

        $base = $this->config->getApiBaseUrl();
        $token = $this->config->getIngestToken();
        if ($base === '' || $token === '') {
            $this->logger->warning('[AiCommerceConversion] API base URL or ingest token is not configured');
            return false;
        }

        $payload = [
            'userId' => $userId !== '' ? $userId : 'anonymous',
            'events' => $events,
        ];
        if ($sessionId && $this->isUuid($sessionId)) {
            $payload['sessionId'] = $sessionId;
        }

        try {
            $this->curl->setTimeout(2);
            $this->curl->setOption(CURLOPT_CONNECTTIMEOUT, 1);
            $this->curl->setHeaders([
                'Content-Type' => 'application/json',
                'X-Analytics-Ingest-Token' => $token,
            ]);
            $this->curl->post($base . '/api/analytics/track', json_encode($payload) ?: '{}');
            $status = (int) $this->curl->getStatus();
            if ($status < 200 || $status >= 300) {
                $this->logger->warning(
                    '[AiCommerceConversion] track HTTP ' . $status . ' ' . $this->curl->getBody()
                );
                return false;
            }
            return true;
        } catch (\Throwable $e) {
            $this->logger->warning('[AiCommerceConversion] track failed: ' . $e->getMessage());
            return false;
        }
    }

    public function isUuid(string $value): bool
    {
        return (bool) preg_match(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i',
            $value
        );
    }
}
