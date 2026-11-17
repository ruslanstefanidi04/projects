"use client";

import React, { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

function BlackRevealSection() {
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!rootRef.current) return;

		const letters =
			rootRef.current.querySelectorAll<HTMLElement>(".letter");

		// общий таймлайн с pin (как в App с кругом)
		const tl = gsap.timeline({
			scrollTrigger: {
				trigger: rootRef.current,
				start: "top top",
				end: "+=150%", // длина анимации
				scrub: true,
				pin: true,
				pinSpacing: true,
			},
		});

		// каждая буква анимируется последовательно
		letters.forEach((el, i) => {
			tl.fromTo(
				el,
				{ backgroundPosition: "0% 100%" }, // низ (серый)
				{ backgroundPosition: "0% 0%", ease: "none" }, // вверх (чёрный)
				i * 0.1 // смещение во времени
			);
		});

		return () => {
			tl.scrollTrigger?.kill();
			tl.kill();
		};
	}, []);

	const text = "MY PORTFOLIO  •  REAL PROJECTS  •  LIVE RESULTS";
	const words = text.split(/\s+/).filter((item) => item !== "");

	// Группируем слова в фразы для десктопа (точка в начале каждой строки)
	const desktopPhrases = [
		{ text: "MY PORTFOLIO", hasDot: true },
		{ text: "REAL PROJECTS", hasDot: true },
		{ text: "LIVE RESULTS", hasDot: true },
	];

	return (
		<section
			ref={rootRef}
			className="relative z-10 w-full h-screen bg-black flex items-center md:items-center justify-center px-2 pr-6 md:px-12"
		>
			{/* Мобильная версия: каждое слово отдельно */}
			<div className="md:hidden text-[17vw] font-extrabold leading-none flex flex-col w-full break-words overflow-wrap-anywhere gap-6">
				{words.map((word, wordIndex) => {
					const isSeparator = word === "•";
					if (isSeparator) return null;
					return (
						<div
							key={wordIndex}
							className="w-full flex justify-center break-words"
						>
							{word.split("").map((letter, i) => (
								<span
									key={i}
									className="letter inline-block
									bg-gradient-to-t from-black from-50% to-gray-500 to-50% 
									bg-[length:100%_200%] 
									bg-clip-text text-transparent"
									style={{
										backgroundPosition: "0% 100%",
										marginRight:
											letter === " " ? "0.3em" : "0",
									}}
								>
									{letter}
								</span>
							))}
						</div>
					);
				})}
			</div>

			{/* Десктопная версия: каждая фраза на своей строке */}
			<div className="hidden md:flex text-[8vw] font-extrabold leading-tight flex-col w-auto break-words">
				{desktopPhrases.map((item, phraseIndex) => (
					<div
						key={phraseIndex}
						className="flex justify-start break-words"
					>
						{item.hasDot && (
							<span
								className="letter inline-block mr-4
								bg-gradient-to-t from-black from-50% to-gray-500 to-50% 
								bg-[length:100%_200%] 
								bg-clip-text text-transparent"
								style={{
									backgroundPosition: "0% 100%",
								}}
							>
								•
							</span>
						)}
						{item.text.split("").map((letter, i) => (
							<span
								key={i}
								className="letter inline-block
								bg-gradient-to-t from-black from-50% to-gray-500 to-50% 
								bg-[length:100%_200%] 
								bg-clip-text text-transparent"
								style={{
									backgroundPosition: "0% 100%",
									marginRight: letter === " " ? "0.3em" : "0",
								}}
							>
								{letter}
							</span>
						))}
					</div>
				))}
			</div>
		</section>
	);
}

export default React.memo(BlackRevealSection);
