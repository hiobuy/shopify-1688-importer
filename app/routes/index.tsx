import { redirect, type LoaderFunctionArgs } from "react-router";
export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  if (url.searchParams.has("shop")) return redirect(`/app${url.search}`);
  return redirect("/auth/login");
}
export default function Index() {
  return null;
}
