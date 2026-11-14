// What create-user hands to auth.admin.createUser, kept apart from index.ts
// so a test can check it without Deno.
//
// Access (role, yard, shipping line) goes in app_metadata, which only the
// service role can write. user_metadata is the `data` field of the public
// POST /auth/v1/signup and of PUT /auth/v1/user, so anyone holding the
// publishable key can put anything there. The handle_new_user trigger reads
// access from app_metadata alone and ignores those keys in user_metadata.

export type NewUserRole =
  | "admin"
  | "user"
  | "inspector"
  | "line_rep"
  | "read_only_admin"
  | "manufacturer_rep";

export interface NewUserMetadataInput {
  fullName: string;
  username: string;
  role: NewUserRole;
  /** Every role except manufacturer_rep, who has no yard. */
  yard_id?: string;
  /** The canonical shipping line code; only kept for a line rep. */
  shipping_line?: string;
}

export function newUserMetadata(input: NewUserMetadataInput) {
  return {
    user_metadata: {
      full_name: input.fullName,
      username: input.username,
    },
    app_metadata: {
      role: input.role,
      ...(input.role === "manufacturer_rep" ? {} : { yard_id: input.yard_id }),
      ...(input.role === "line_rep" ? { shipping_line: input.shipping_line } : {}),
    },
  };
}
