import "./sections.css";

const contactLinks = [
	{
		label: "Write on Upwork",
		href: "https://www.upwork.com/freelancers/~01440ff24f884c72d0",
	},
	{
		label: "Message on Kwork",
		href: "https://kwork.ru/user/ruslanstefanidi04",
	},
	{
		label: "Ping me on GitHub",
		href: "https://github.com/rooin13",
	},
	{
		label: "Email: roorui13@gmail.com",
		href: "mailto:roorui13@gmail.com",
	},
];

export function ContactSection() {
	return (
		<section className="section" id="contact">
			<div className="container">
				<div className="contact-card">
					<span className="badge">Let’s collaborate</span>
					<h3>Готов подключиться к вашему продукту.</h3>
					<p>
						Заказывайте продакшн-frontend без боли: чистая
						архитектура, быстрые итерации, интеграции и поддержка
						после релиза.
					</p>
					<div
						className="cta-buttons"
						style={{ justifyContent: "center" }}
					>
						<a
							className="button button--primary"
							href="mailto:roorui13@gmail.com"
						>
							Start a project
						</a>
						<a
							className="button button--ghost"
							href="https://cal.com/"
							target="_blank"
							rel="noreferrer"
						>
							Book a call
						</a>
					</div>
					<div className="contact-links">
						{contactLinks.map((link) => (
							<a
								key={link.label}
								href={link.href}
								target="_blank"
								rel="noreferrer"
							>
								{link.label}
							</a>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}
