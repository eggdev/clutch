/** Who is acting, and in which organization. Every server change runs as one actor. */
export type Actor = {
  readonly userId: string;
  readonly organizationId: string;
};
