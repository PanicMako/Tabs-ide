const form = document.getElementById("calculator");
const result = document.getElementById("result");
const errorOutput = document.getElementById("error");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const first = Number(form.elements.namedItem("first").value);
  const second = Number(form.elements.namedItem("second").value);
  const commandId = form.elements.namedItem("operation").value;
  errorOutput.textContent = "";
  result.textContent = "Calculating...";
  try {
    const answer = await window.tabsExtension.logic.invoke(commandId, { first, second });
    result.textContent = `Result: ${answer}`;
  } catch (error) {
    result.textContent = "";
    errorOutput.textContent = `Calculation failed: ${String(error)}`;
  }
});
