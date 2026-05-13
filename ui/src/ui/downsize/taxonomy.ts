export type Taxonomy = ReadonlyArray<{
  department: string;
  categories: ReadonlyArray<string>;
}>;

export const DEFAULT_TAXONOMY: Taxonomy = [
  { department: "Unsorted", categories: ["Unsorted"] },
  { department: "Apparel", categories: ["Women", "Men", "Kids", "Shoes", "Accessories"] },
  { department: "Home", categories: ["Kitchen", "Bath", "Decor", "Furniture", "Storage"] },
  { department: "Electronics", categories: ["Phones", "Computers", "Audio", "Cameras", "Gaming"] },
  { department: "Books & Media", categories: ["Books", "Movies", "Music", "Games"] },
  { department: "Sports & Outdoors", categories: ["Fitness", "Outdoor", "Bikes", "Team Sports"] },
  { department: "Toys & Kids", categories: ["Toys", "Baby", "Kids Gear"] },
  { department: "Beauty", categories: ["Makeup", "Skincare", "Hair"] },
  { department: "Collectibles", categories: ["Cards", "Figures", "Vintage", "Art"] },
  { department: "Tools & Garden", categories: ["Tools", "Garden", "DIY"] },
] as const;

export function categoriesForDepartment(
  taxonomy: Taxonomy,
  department: string,
): ReadonlyArray<string> {
  return taxonomy.find((entry) => entry.department === department)?.categories ?? ["Unsorted"];
}

