import "./sections.css";

const skillGroups = [
	{
		title: "Core Stack",
		items: [
			"React",
			"Next.js (App Router)",
			"TypeScript",
			"Vite",
			"Redux Toolkit",
		],
	},
	{
		title: "Backend & Data",
		items: [
			"Node.js",
			"Prisma ORM",
			"PostgreSQL",
			"REST/GraphQL",
			"Stripe",
			"NextAuth",
		],
	},
	{
		title: "UI & UX",
		items: [
			"Tailwind CSS",
			"shadcn/ui",
			"Framer Motion",
			"Responsive & a11y",
			"Figma to code",
		],
	},
	{
		title: "Architecture & Tooling",
		items: [
			"Feature-Sliced Design",
			"Monorepos",
			"CI/CD",
			"PM2",
			"Nginx",
			"Linux deployment",
		],
	},
];

export function SkillsSection() {
	return (
		<section className="section" id="skills">
			<div className="container">
				<div className="section-title">
					<span className="badge">Skills & Tech</span>
					<h2>I ship production systems, not только красивые UI.</h2>
					<p>
						Я закрываю полный фронтовый цикл: от верстки и
						интеграции дизайна до подключения API, платежей,
						авторизации и выкатки в прод на Linux.
					</p>
				</div>
				<div className="skills-grid">
					{skillGroups.map((group) => (
						<div className="skill-card" key={group.title}>
							<h3>{group.title}</h3>
							<ul>
								{group.items.map((item) => (
									<li key={item}>{item}</li>
								))}
							</ul>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
