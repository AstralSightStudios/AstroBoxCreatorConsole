import plugin from "tailwindcss/plugin";

/** @type {import('tailwindcss').Config} */
export default {
    content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
    theme: {
        extend: {
            dataCardMinWidth: {
                sm: "180px",
                md: "230px",
                lg: "280px",
            },
        },
    },
    plugins: [
        plugin(function ({ matchUtilities, theme }) {
            matchUtilities(
                {
                    "datacard-grid": (value) => ({
                        display: "grid",
                        gridTemplateColumns: `repeat(auto-fit, minmax(${value}, 1fr))`,
                    }),
                },
                {
                    values: theme("dataCardMinWidth"),
                    type: "length",
                },
            );
        }),
    ],
};
