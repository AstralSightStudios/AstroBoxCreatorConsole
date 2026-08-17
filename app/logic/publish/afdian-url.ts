export interface ParsedAfdUrl {
  productId?: string;
  productType?: number;
  skuIds: string[];
}

export function parseAfdUrl(url: string): ParsedAfdUrl {
  try {
    const parsedUrl = new URL(url);
    const productId = parsedUrl.searchParams.get("plan_id")?.trim() || undefined;
    const productTypeRaw = parsedUrl.searchParams.get("product_type");
    const productType = productTypeRaw ? Number(productTypeRaw) : undefined;
    const skuRaw = parsedUrl.searchParams.get("sku");
    if (!skuRaw) {
      return { productId, productType, skuIds: [] };
    }

    const skuItems = JSON.parse(skuRaw);
    const skuIds = Array.isArray(skuItems)
      ? Array.from(
          new Set(
            skuItems
              .map((item) =>
                typeof item?.sku_id === "string" ? item.sku_id.trim() : "",
              )
              .filter(Boolean),
          ),
        )
      : [];

    return {
      productId,
      productType: Number.isFinite(productType) ? productType : undefined,
      skuIds,
    };
  } catch {
    return { skuIds: [] };
  }
}
