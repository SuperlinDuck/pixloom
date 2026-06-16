export const PRODUCT_DRAFT_STORAGE_KEY = "pixloom.product-draft"

export type ProductDraft = {
  productName: string
  productDescription: string
  highlights: string
  category: "drinkware" | "beauty" | "fashion" | "home"
  useCase: "mainImage" | "sceneImage" | "sellingPoints" | "detailSet"
  scene: "studio" | "kitchen" | "livingRoom" | "outdoor"
  imageDataUrl?: string
  imageName?: string
}
