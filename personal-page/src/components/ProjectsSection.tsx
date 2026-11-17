import "./sections.css";

const projects = [
	{
		title: "Marusya Movies Platform",
		description:
			"Каталог фильмов с auth, динамическими фильтрами, Supabase и адаптивным UI.",
		stack: "Next.js 14 • TypeScript • Supabase • Tailwind • shadcn/ui",
		url: "https://marusya-kappa.vercel.app/",
	},
	{
		title: "W-Wave AI Music",
		description:
			"AI-плейлисты, Spotify-интеграция, real-time плеер, многоязычный интерфейс.",
		stack: "Next.js 14 • TypeScript • Zustand/Redux • Tailwind • Framer Motion",
		url: "https://w-wave-next.vercel.app/",
	},
	{
		title: "Hex Devices E-commerce",
		description:
			"Продвинутая витрина устройств с фильтрами, корзиной и UI checkout.",
		stack: "Next.js • TypeScript • Redux Toolkit • Tailwind • Prisma (mock)",
		url: "https://hex-six-sooty.vercel.app/",
	},
];

export function ProjectsSection() {
	return (
		<section className="section" id="projects">
			<div className="container">
				<div className="section-title">
					<span className="badge">Selected work</span>
					<h2>Проекты, которые показывают боевую готовность.</h2>
					<p>
						Каждый из этих проектов можно открыть в продакшне —
						никаких фейковых макетов. Всё отрисовано, подключено к
						API и настроено под реальную нагрузку.
					</p>
				</div>
				<div className="projects-grid">
					{projects.map((project) => (
						<div className="project-card" key={project.title}>
							<h3>{project.title}</h3>
							<p>{project.description}</p>
							<div className="project-meta">{project.stack}</div>
							<div className="project-links">
								<a
									href={project.url}
									target="_blank"
									rel="noreferrer"
								>
									Live preview →
								</a>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
