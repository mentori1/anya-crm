import { randomUUID } from "node:crypto";
import Link from "next/link";
import { createClient } from "@/lib/actions";

type SearchParams = Promise<{ error?: string; id?: string }>;

export default async function NewClientPage({ searchParams }: { searchParams: SearchParams }) {
  const { error, id } = await searchParams;
  const submissionKey = randomUUID();
  return (
    <div className="page-stack narrow-page">
      <header className="page-heading">
        <div><Link href="/clients" className="back-link">← Клиенты</Link><p className="eyebrow">Новая запись</p><h1>Добавить клиента</h1><p>Сначала фиксируем контакт. Цели, план и программу добавим в карточке.</p></div>
      </header>
      <section className="panel form-panel">
        {error === "name" ? <p className="form-banner">Укажи имя клиента.</p> : null}
        {error === "duplicate" ? <p className="form-banner">Такой контакт уже есть. <Link href={`/clients/${id}`}>Открыть карточку</Link></p> : null}
        <form action={createClient} className="data-form">
          <input type="hidden" name="submissionKey" value={submissionKey} />
          <label className="field-wide"><span>Имя клиента *</span><input name="fullName" required placeholder="Например, Мария Соколова" /></label>
          <label><span>Телефон</span><input name="phone" type="tel" placeholder="+7 999 000-00-00" /></label>
          <label><span>Telegram</span><input name="telegram" placeholder="@username" /></label>
          <label><span>Email</span><input name="email" type="email" placeholder="name@example.com" /></label>
          <label><span>Источник</span><input name="source" placeholder="Рекомендация, эфир, реклама" /></label>
          <label><span>Статус</span><select name="status" defaultValue="new"><option value="new">Новый</option><option value="active">В работе</option><option value="paused">Пауза</option><option value="completed">Завершил</option><option value="upsell">На допродажу</option></select></label>
          <label><span>Следующий контакт</span><input name="nextContactAt" type="date" /></label>
          <div className="form-actions field-wide"><Link href="/clients" className="button-secondary">Отмена</Link><button className="button-primary">Сохранить клиента</button></div>
        </form>
      </section>
    </div>
  );
}
