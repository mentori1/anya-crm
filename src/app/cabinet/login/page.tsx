import { redirect } from "next/navigation";
import { ClientLoginForm } from "@/components/ClientLoginForm";
import { getClientPortalSession } from "@/lib/client-auth";

type SearchParams = Promise<{ client?: string }>;

export default async function ClientLoginPage({ searchParams }: { searchParams: SearchParams }) {
  if (await getClientPortalSession()) redirect("/cabinet");
  const { client = "" } = await searchParams;
  return (
    <main className="login-page client-login-page">
      <section className="login-card">
        <span className="brand-mark brand-mark-large">А</span>
        <span className="eyebrow">Личное пространство</span>
        <h1>Мой кабинет</h1>
        <p>Здесь находятся цели, план, ближайшие созвоны, ссылки и материалы.</p>
        {client ? <ClientLoginForm publicId={client} /> : <div className="form-banner">Открой персональную ссылку, которую прислала Аня.</div>}
      </section>
    </main>
  );
}
