import "./sections.css";

const socialLinks = [
	{
		label: "GitHub",
		href: "https://github.com/rooin13",
	},
	{
		label: "Upwork",
		href: "https://www.upwork.com/freelancers/~01440ff24f884c72d0",
	},
	{
		label: "Kwork",
		href: "https://kwork.ru/user/ruslanstefanidi04",
	},
];

const heroHighlights = [
	"Production-ready frontends на Next.js 14 + TypeScript",
	"Полная продуктовая логика: auth, dashboards, фильтры, корзины",
	"Интеграции Stripe, NextAuth, Prisma, REST/GraphQL",
	"SEO, SSR/SSG и Lighthouse 90+ из коробки",
];

export function HeroSection() {
	return (
		<section className="section hero" id="top">
			<div className="container hero__content">
				<div className="hero__intro">
					<span className="badge">Next.js Frontend Engineer</span>
					<h1>
						Hi, I’m Ruslan. I build modern web apps that ship to
						production.
					</h1>
					<p className="muted">
						I focus on чистую архитектуру, скорость и качество,
						которое ощущается в реальных продуктах — от
						высококонверсионных лендингов до сложных SaaS и
						e-commerce платформ.
					</p>
					<ul className="hero__highlights">
						{heroHighlights.map((item) => (
							<li key={item}>{item}</li>
						))}
					</ul>
					<div className="cta-buttons">
						<a
							className="button button--primary"
							href="mailto:roorui13@gmail.com"
						>
							Discuss a Project
						</a>
						<a
							className="button button--ghost"
							href="https://drive.google.com/drive/folders/1UyTN9cQbhNGMFaZq9wVh35Zj9TfLQIFP?usp=sharing"
							target="_blank"
							rel="noreferrer"
						>
							View Case Studies
						</a>
					</div>
					<div className="hero__links">
						{socialLinks.map((link) => (
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
				<div className="hero__badge-grid">
					<div className="hero__card">
						<h3>Full-stack ready</h3>
						<p>
							Next.js 14 • TypeScript • Prisma • PostgreSQL •
							Stripe
						</p>
					</div>
					<div className="hero__card">
						<h3>Scale-friendly architecture</h3>
						<p>
							Feature-Sliced Design, code refactors, long-term
							support
						</p>
					</div>
					<div className="hero__card">
						<h3>Speed & SEO first</h3>
						<p>
							SSR/SSG, 90+ Lighthouse, оптимизированные bundle’ы
						</p>
					</div>
				</div>
			</div>
		</section>
	);
}
