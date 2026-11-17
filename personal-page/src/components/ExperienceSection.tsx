import "./sections.css";

const experiences = [
	{
		title: "Full-stack Developer | Gaming Marketplace (NDA)",
		period: "May 2025 — Jul 2025",
		bullets: [
			"Delivered a realtime trading marketplace built on Next.js 14 and TypeScript",
			"Implemented RBAC, admin console, Stripe payments, and complex transaction logic",
			"Handled DevOps: Linux servers, Nginx, PM2, SSL, automated deployments",
			"Managed PostgreSQL + Prisma, ongoing maintenance and feature iterations",
		],
	},
	{
		title: "Frontend Developer | Custom Knives Pegasus",
		period: "May 2024 — Apr 2025",
		bullets: [
			"Built product catalog, product detail, cart, and checkout UI in React/Next.js",
			"Styled the entire storefront with Tailwind CSS, mobile-first responsive approach",
			"Managed state with Redux Toolkit and integrated REST APIs with backend team",
		],
	},
];

export function ExperienceSection() {
	return (
		<section className="section" id="experience">
			<div className="container">
				<div className="section-title">
					<span className="badge">Commercial experience</span>
					<h2>Real projects shipped to production.</h2>
					<p>
						I take ownership from UI to deployment — collaborating
						with teams, bridging the gap between design and
						engineering, and maintaining products after launch.
					</p>
				</div>
				<div className="experience-timeline">
					{experiences.map((item) => (
						<div className="experience-card" key={item.title}>
							<h3>{item.title}</h3>
							<div className="experience-meta">{item.period}</div>
							<ul>
								{item.bullets.map((bullet) => (
									<li key={bullet}>{bullet}</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
