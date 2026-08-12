<?php

declare(strict_types=1);

namespace Klizer\AiCommerceConversion\Observer;

use Klizer\AiCommerceConversion\Model\ConversionTracker;
use Magento\Framework\Event\Observer;
use Magento\Framework\Event\ObserverInterface;
use Magento\Sales\Model\Order;
use Psr\Log\LoggerInterface;

class TrackOrder implements ObserverInterface
{
    public function __construct(
        private readonly ConversionTracker $tracker,
        private readonly LoggerInterface $logger
    ) {
    }

    public function execute(Observer $observer): void
    {
        try {
            $order = $observer->getEvent()->getOrder();
            if (!$order instanceof Order) {
                return;
            }
            $this->tracker->trackOrder($order);
        } catch (\Throwable $e) {
            $this->logger->warning('[AiCommerceConversion] order track skipped: ' . $e->getMessage());
        }
    }
}
