<?php

declare(strict_types=1);

namespace Klizer\AiCommerceConversion\Observer;

use Klizer\AiCommerceConversion\Model\ConversionTracker;
use Magento\Checkout\Model\Session as CheckoutSession;
use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Psr\Log\LoggerInterface;

class TrackCheckout implements ObserverInterface
{
    public function __construct(
        private readonly ConversionTracker $tracker,
        private readonly CheckoutSession $checkoutSession,
        private readonly LoggerInterface $logger
    ) {
    }

    public function execute(Observer $observer): void
    {
        try {
            $quote = $this->checkoutSession->getQuote();
            $quoteId = (string) $quote->getId();
            if ($quoteId === '') {
                return;
            }
            $flag = 'klizer_ai_checkout_' . $quoteId;
            if ($this->checkoutSession->getData($flag)) {
                return;
            }
            if ($this->tracker->trackCheckout($quote)) {
                $this->checkoutSession->setData($flag, 1);
            }
        } catch (\Throwable $e) {
            $this->logger->warning('[AiCommerceConversion] checkout track skipped: ' . $e->getMessage());
        }
    }
}
