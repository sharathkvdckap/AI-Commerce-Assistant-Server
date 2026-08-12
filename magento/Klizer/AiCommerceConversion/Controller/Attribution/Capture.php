<?php

declare(strict_types=1);

namespace Klizer\AiCommerceConversion\Controller\Attribution;

use Klizer\AiCommerceConversion\Model\AttributionCookie;
use Magento\Framework\App\Action\HttpGetActionInterface;
use Magento\Framework\App\RequestInterface;
use Magento\Framework\Controller\Result\JsonFactory;

class Capture implements HttpGetActionInterface
{
    public function __construct(
        private readonly RequestInterface $request,
        private readonly JsonFactory $jsonFactory,
        private readonly AttributionCookie $cookie
    ) {
    }

    public function execute()
    {
        $searchId = trim((string) $this->request->getParam('ai_search_id', ''));
        $sku = trim((string) $this->request->getParam('ai_sku', ''));
        if ($searchId !== '' && $sku !== '') {
            $this->cookie->capture([
                'searchId' => $searchId,
                'sku' => $sku,
                'sessionId' => (string) $this->request->getParam('ai_session_id', ''),
                'userId' => (string) $this->request->getParam('ai_uid', ''),
                'source' => (string) $this->request->getParam('ai_source', ''),
                'productId' => (string) $this->request->getParam('ai_pid', ''),
                'productName' => (string) $this->request->getParam('ai_pname', ''),
            ]);
        }

        $result = $this->jsonFactory->create();
        $result->setHttpResponseCode(204);
        return $result;
    }
}
