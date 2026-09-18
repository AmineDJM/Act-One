import { PRODUCT_PHASE_LABELS, ProductPhase, TrademarkStatus, productName, signUpPolicy } from '@act-one/core';
import { getProductConfig } from '@/server/product.ts';
import { site } from '@/lib/site.ts';
import { ProductForm } from './ProductForm.tsx';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/**
 * What the product is right now.
 *
 * The phase decides the door and the words on the public pages; the mark
 * decides whether the name carries ™ or ®. All of it is read by the site
 * within a minute of a save, and none of it is written into a page by hand.
 */
export default async function ProductPage() {
  const config = await getProductConfig();
  const policy = signUpPolicy(config);
  return (
    <>
      <header className={styles.head}>
        <h1>Product</h1>
        <p className="lede">
          {PRODUCT_PHASE_LABELS[config.phase]} · the public button says “{policy.ctaLabel}” · the name reads “{productName(site.name, config.trademarkStatus)}”.
        </p>
      </header>
      <ProductForm config={config} phases={ProductPhase.options} trademarks={TrademarkStatus.options} />
    </>
  );
}
