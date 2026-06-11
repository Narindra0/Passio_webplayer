export type Album = {
  id: string;
  artist_id?: string;
  title: string;
  description?: string | null;
  price_ariary?: number;
  cover_url?: string | null;
  status?: string;
  artist_name?: string;
  artist_pdp?: string | null;
  artist?: {
    id?: string;
    name?: string;
    slug?: string;
    profile_picture_url?: string | null;
  } | null;
};
